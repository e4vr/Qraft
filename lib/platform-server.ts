import { env } from 'cloudflare:workers';
import {
  assertSameOrigin,
  currentUser,
  json,
  profileById,
  readJson,
} from './cloudflare-server';
import {
  canAccessBank,
  canManageBank,
  canReviewBank,
  initialCollaborationState,
  optionLabel,
  type AppUser,
  type MemberProfile,
  type Question,
  type QuestionProposal,
  type QBank,
  type QBankMembership,
} from './medguard-types';
import { parseQuestionImport } from './question-import';

export async function bankAccessState(bankId: string) {
  const rows = await env.DB.prepare(
    "SELECT type,payload FROM records WHERE (type='qbanks' AND id=?) OR (type='qbankMemberships' AND qbank_id=?)",
  )
    .bind(bankId, bankId)
    .all<{ type: string; payload: string }>();
  return {
    qbanks: rows.results
      .filter((r) => r.type === 'qbanks')
      .map((r) => JSON.parse(r.payload) as QBank)
      .concat(
        bankId === 'smle-gs' && !rows.results.some((r) => r.type === 'qbanks')
          ? initialCollaborationState().qbanks
          : [],
      ),
    memberships: rows.results
      .filter((r) => r.type === 'qbankMemberships')
      .map((r) => JSON.parse(r.payload) as QBankMembership),
  };
}

export function auditStatement(
  user: AppUser,
  action: string,
  target: string,
  previous: unknown,
  next: unknown,
  status = 'success',
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return env.DB.prepare(
    'INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES(?,?,?,?,?)',
  ).bind(
    'auditLog',
    id,
    user.uid,
    JSON.stringify({
      id,
      action,
      entityType: 'account',
      entityId: target,
      actorId: user.uid,
      actorName: user.displayName,
      createdAt: now,
      detail: JSON.stringify({ previous, next, status }),
    }),
    now,
  );
}

export async function expireSubscriptions() {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO records(type,id,owner_id,payload,updated_at) SELECT 'auditLog','expired-'||user_id||'-'||expires_at,user_id,json_object('id','expired-'||user_id||'-'||expires_at,'action','subscription_expired','entityType','account','entityId',user_id,'actorId','system','actorName','Qraft','createdAt',?,'detail','Subscription expired; returned to Lite.'),? FROM subscriptions WHERE status IN ('active','manually_activated') AND expires_at<=? ON CONFLICT(type,id) DO NOTHING`,
    ).bind(now, now, now),
    env.DB.prepare(
      `UPDATE profiles SET profile_json=json_set(profile_json,'$.tier','lite'),updated_at=? WHERE uid IN(SELECT user_id FROM subscriptions WHERE status IN ('active','manually_activated') AND expires_at<=?)`,
    ).bind(now, now),
    env.DB.prepare(
      `UPDATE subscriptions SET status='expired',updated_at=? WHERE status IN ('active','manually_activated') AND expires_at<=?`,
    ).bind(now, now),
  ]);
}

type Discount = {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  amount: number;
  enabled: number;
  starts_at: string | null;
  expires_at: string | null;
  max_uses: number | null;
  per_user: number | null;
  uses: number;
};
async function quote(user: AppUser, code: string) {
  const original = (await env.DB.prepare(
    'SELECT price FROM subscription_settings WHERE id=1',
  ).first<{ price: number }>())!.price;
  const discount = code
    ? await env.DB.prepare(
        'SELECT * FROM discount_codes WHERE code=? COLLATE NOCASE',
      )
        .bind(code)
        .first<Discount>()
    : null;
  if (code && !discount)
    throw new Error('كود الخصم غير صحيح / Invalid discount code.');
  if (discount) {
    const now = new Date().toISOString();
    if (!discount.enabled)
      throw new Error('كود الخصم غير مفعّل / Code disabled.');
    if (discount.starts_at && discount.starts_at > now)
      throw new Error('لم يبدأ الكود بعد / Code not yet active.');
    if (discount.expires_at && discount.expires_at <= now)
      throw new Error('انتهت صلاحية الكود / Code expired.');
    if (discount.max_uses !== null && discount.uses >= discount.max_uses)
      throw new Error(
        'تم بلوغ الحد الأقصى لاستخدام الكود / Usage limit reached.',
      );
    const used = await env.DB.prepare(
      "SELECT count(*) AS n FROM subscription_events WHERE user_id=? AND code_id=? AND status='success' AND action='discount_redeemed'",
    )
      .bind(user.uid, discount.id)
      .first<{ n: number }>();
    if (discount.per_user !== null && (used?.n ?? 0) >= discount.per_user)
      throw new Error('استخدمت هذا الكود مسبقًا / Your usage limit is reached.');
  }
  const saved = Math.min(
    original,
    discount
      ? discount.kind === 'percent'
        ? Math.round((original * discount.amount) / 100)
        : discount.amount
      : 0,
  );
  return {
    original,
    discount: saved,
    final: original - saved,
    code: discount?.code ?? '',
    codeId: discount?.id ?? null,
    percent: discount?.kind === 'percent' ? discount.amount : null,
  };
}

export async function platformApi(request: Request, action: string) {
  if (request.method !== 'GET') assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved' || user.suspended)
    return json({ error: 'Approved account required.' }, 403);
  const url = new URL(request.url);
  const input =
    request.method === 'GET'
      ? {}
      : await readJson<Record<string, unknown>>(request, 2_000_000);
  const text = (key: string) =>
    typeof input[key] === 'string' ? (input[key] as string).trim() : '';
  const root =
    user.role === 'super_admin' && user.mfaEnrolled && user.mfaVerified;
  try {
    if (action === 'bulk-review') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const rawProposalIds = input.proposalIds;
      if (!Array.isArray(rawProposalIds) || rawProposalIds.length < 1 || rawProposalIds.length > 200 || rawProposalIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 200))
        return json({ error: 'Choose between 1 and 200 pending questions.' }, 400);
      const proposalIds = [...new Set(rawProposalIds as string[])];
      const status = text('status');
      if ((status !== 'approved' && status !== 'rejected'))
        return json({ error: 'Choose between 1 and 200 pending questions.' }, 400);

      const rows = await env.DB.prepare(
        "SELECT id,payload FROM records WHERE type='questionProposals' AND id IN (SELECT value FROM json_each(?))",
      ).bind(JSON.stringify(proposalIds)).all<{ id: string; payload: string }>();
      if (rows.results.length !== proposalIds.length) return json({ error: 'One or more proposals no longer exist. Refresh and try again.' }, 409);
      const proposals = rows.results.map(row => JSON.parse(row.payload) as QuestionProposal);
      const bankStates = new Map<string, Awaited<ReturnType<typeof bankAccessState>>>();
      for (const bankId of new Set(proposals.map(proposal => proposal.qbankId))) {
        const state = await bankAccessState(bankId);
        const bank = state.qbanks.find(item => item.id === bankId);
        if (!bank || !canReviewBank(user, bank, state.memberships)) return json({ error: 'Reviewer access is required for every selected QBank.' }, 403);
        bankStates.set(bankId, state);
      }
      if (proposals.some(proposal => proposal.status !== 'pending' || proposal.proposedById === user.uid))
        return json({ error: 'Some selected questions were already reviewed or were submitted by you. Refresh and try again.' }, 409);

      const existingIds = [...new Set(proposals.filter(proposal => proposal.type === 'question_edit').map(proposal => proposal.questionId).filter((id): id is string => Boolean(id)))];
      const existingRows = existingIds.length
        ? await env.DB.prepare("SELECT id,payload FROM records WHERE type='sharedQuestions' AND id IN (SELECT value FROM json_each(?))")
            .bind(JSON.stringify(existingIds)).all<{ id: string; payload: string }>()
        : { results: [] as Array<{ id: string; payload: string }> };
      const existingQuestions = new Map(existingRows.results.map(row => [row.id, JSON.parse(row.payload) as Question]));
      if (proposals.some(proposal => proposal.type === 'question_edit' && (!proposal.questionId || !existingQuestions.has(proposal.questionId))))
        return json({ error: 'A question changed or was deleted while you were reviewing it. Refresh and try again.' }, 409);

      const reservedByBank = new Map<string, string[]>();
      if (status === 'approved') {
        for (const bankId of new Set(proposals.filter(proposal => proposal.type === 'new_question').map(proposal => proposal.qbankId))) {
          const count = proposals.filter(proposal => proposal.type === 'new_question' && proposal.qbankId === bankId).length;
          const allocated = await env.DB.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<99999)
            INSERT INTO question_ids(question_id,qbank_id,created_by_id,created_at)
            SELECT printf('%05d',n),?,?,? FROM numbers WHERE NOT EXISTS(SELECT 1 FROM question_ids WHERE question_id=printf('%05d',n)) AND NOT EXISTS(SELECT 1 FROM question_registry WHERE question_id=printf('%05d',n)) ORDER BY n LIMIT ? RETURNING question_id`)
            .bind(bankId, user.uid, new Date().toISOString(), count).all<{ question_id: string }>();
          if (allocated.results.length !== count) return json({ error: 'Question ID capacity reached.' }, 409);
          reservedByBank.set(bankId, allocated.results.map(item => item.question_id));
        }
      }

      const now = new Date().toISOString();
      const nextNumbers = new Map<string, number>();
      if (status === 'approved') {
        for (const bankId of new Set(proposals.map(proposal => proposal.qbankId))) {
          const maximum = await env.DB.prepare("SELECT coalesce(max(CAST(json_extract(payload,'$.number') AS INTEGER)),0) AS value FROM records WHERE type='sharedQuestions' AND qbank_id=?")
            .bind(bankId).first<{ value: number }>();
          nextNumbers.set(bankId, maximum?.value ?? 0);
        }
      }
      const statements: D1PreparedStatement[] = [];
      for (const proposal of proposals) {
        const existing = proposal.questionId ? existingQuestions.get(proposal.questionId) : undefined;
        const internalId = proposal.type === 'new_question' ? `shared-${crypto.randomUUID()}` : proposal.questionId!;
        const reviewedProposal: QuestionProposal = {
          ...proposal,
          status,
          questionId: status === 'approved' ? internalId : proposal.questionId,
          reviewedById: user.uid,
          reviewedByName: user.displayName,
          reviewedAt: now,
        };
        statements.push(env.DB.prepare("UPDATE records SET payload=?,updated_at=? WHERE type='questionProposals' AND id=? AND json_extract(payload,'$.status')='pending'")
          .bind(JSON.stringify(reviewedProposal), now, proposal.id));
        if (status === 'approved') {
          const number = existing?.number ?? (nextNumbers.set(proposal.qbankId, (nextNumbers.get(proposal.qbankId) ?? 0) + 1), nextNumbers.get(proposal.qbankId)!);
          const displayId = existing?.questionId ?? reservedByBank.get(proposal.qbankId)!.shift()!;
          const question: Question = {
            id: internalId,
            questionId: displayId,
            number,
            qbankId: proposal.qbankId,
            specialty: proposal.payload.specialty,
            topic: proposal.payload.topic,
            stem: proposal.payload.stem,
            options: proposal.payload.options,
            answer: proposal.payload.answer,
            answerLetter: optionLabel(proposal.payload.answer),
            explanation: proposal.payload.explanation,
            sourceReference: proposal.payload.sourceReference,
            sourcePage: existing?.sourcePage ?? 0,
            sourceFile: existing?.sourceFile ?? proposal.payload.sourceReference,
            revision: (existing?.revision ?? 0) + 1,
            isCustom: true,
            images: proposal.payload.images ?? existing?.images ?? [],
            writtenById: proposal.type === 'new_question' ? proposal.proposedById : (existing?.writtenById ?? 'system'),
            writtenByName: proposal.type === 'new_question' ? proposal.proposedByName : (existing?.writtenByName ?? 'Qraft'),
            reviewedById: user.uid,
            reviewedByName: user.displayName,
            reviewedAt: now,
          };
          statements.push(env.DB.prepare("INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('sharedQuestions',?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET qbank_id=excluded.qbank_id,payload=excluded.payload,updated_at=excluded.updated_at")
            .bind(question.id, question.qbankId, JSON.stringify(question), now));
        }
      }
      statements.push(auditStatement(user, `questions_bulk_${status}`, crypto.randomUUID(), null, {
        count: proposals.length,
        proposalIds,
        submitters: [...new Set(proposals.map(proposal => proposal.proposedById))],
      }));
      await env.DB.batch(statements);
      return json({ ok: true, reviewed: proposals.length });
    }
    if (action === 'review-history') {
      if (request.method === 'GET') {
        const record = await env.DB.prepare("SELECT payload FROM records WHERE type='reviewHistoryPreferences' AND id=? AND owner_id=?").bind(user.uid, user.uid).first<{ payload: string }>();
        return json(record ? JSON.parse(record.payload) : { clearedAt: '' });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const clearedAt = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('reviewHistoryPreferences',?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
          .bind(user.uid, user.uid, JSON.stringify({ clearedAt }), clearedAt),
        auditStatement(user, 'review_history_cleared', user.uid, null, { clearedAt }),
      ]);
      return json({ clearedAt });
    }
    if (action === 'quote' && request.method === 'POST')
      return json(await quote(user, text('code')));
    if (action === 'checkout' && request.method === 'POST') {
      const id = text('requestId');
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(id))
        return json({ error: 'Invalid request ID.' }, 400);
      const prior = await env.DB.prepare(
        'SELECT status,user_id FROM subscription_events WHERE id=?',
      )
        .bind(id)
        .first<{ status: string; user_id: string }>();
      if (prior)
        return prior.user_id === user.uid && prior.status === 'success'
          ? json({ upgraded: true })
          : json({ error: 'Please retry with a new request.' }, 409);
      if (user.tier === 'pro')
        return json({ error: 'Your account is already Pro.' }, 409);
      const price = await quote(user, text('code'));
      const now = new Date().toISOString();
      const end = new Date(now);
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      if (price.final === 0 && price.codeId) {
        try {
          await env.DB.batch([
            env.DB.prepare(
              'INSERT INTO subscription_events(id,user_id,email,name,code_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            ).bind(
              id,
              user.uid,
              user.email,
              user.displayName,
              price.codeId,
              price.code,
              'discount_redeemed',
              price.original,
              price.discount,
              0,
              'success',
              now,
              end.toISOString(),
              now,
              'One year Pro',
            ),
            auditStatement(
              user,
              'discount_redeemed',
              user.uid,
              { tier: 'lite' },
              {
                tier: 'pro',
                ...price,
                startsAt: now,
                expiresAt: end.toISOString(),
              },
            ),
          ]);
        } catch {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO subscription_events(id,user_id,email,name,code_id,code,action,original,discount,final,status,created_at,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
            .bind(
              id,
              user.uid,
              user.email,
              user.displayName,
              price.codeId,
              price.code,
              'discount_redeemed',
              price.original,
              price.discount,
              price.final,
              'failed',
              now,
              'Redemption rejected; code changed, exhausted, or account already upgraded.',
            )
            .run();
          return json(
            {
              error:
                'تعذر تطبيق الترقية؛ أعد تطبيق الكود للتحقق من صلاحيته / Reapply the code and try again.',
            },
            409,
          );
        }
        return json({ upgraded: true });
      }
      if (price.final === 0)
        return json(
          { error: 'A valid discount code is required for a free activation.' },
          400,
        );
      const message = `أرغب بالاشتراك في Qraft Pro لمدة سنة.\nName: ${user.displayName}\nEmail: ${user.email}\nUser ID: ${user.uid}\nOriginal: ${price.original / 100} SAR\nCode: ${price.code || 'None'}\nDiscount: ${price.discount / 100} SAR\nFinal: ${price.final / 100} SAR`;
      return json({
        url: `https://wa.me/966537043984?text=${encodeURIComponent(message)}`,
      });
    }
    if (action === 'discounts') {
      if (!root) return json({ error: 'Superadmin MFA required.' }, 403);
      if (request.method === 'GET') {
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const rows = await env.DB.prepare(
          'SELECT * FROM discount_codes ORDER BY updated_at DESC LIMIT 51 OFFSET ?',
        )
          .bind(offset)
          .all();
        const events = url.searchParams.get('id')
          ? await env.DB.prepare(
              'SELECT * FROM subscription_events WHERE code_id=? ORDER BY created_at DESC LIMIT 51 OFFSET ?',
            )
              .bind(url.searchParams.get('id'), offset)
              .all()
          : { results: [] };
        return json({
          codes: rows.results,
          events: events.results,
          price: (await env.DB.prepare(
            'SELECT price FROM subscription_settings WHERE id=1',
          ).first<{ price: number }>())!.price,
        });
      }
      if (text('operation') === 'price') {
        const price = Number(input.price);
        if (!Number.isInteger(price) || price < 1 || price > 10000000)
          throw new Error('Price must be between 0.01 and 100000 SAR.');
        const old = await env.DB.prepare(
          'SELECT price FROM subscription_settings WHERE id=1',
        ).first();
        await env.DB.batch([
          env.DB.prepare(
            'UPDATE subscription_settings SET price=? WHERE id=1',
          ).bind(price),
          auditStatement(user, 'subscription_price_changed', 'price', old, {
            price,
          }),
        ]);
        return json({ ok: true });
      }
      const id = text('id') || crypto.randomUUID();
      const old = await env.DB.prepare(
        'SELECT * FROM discount_codes WHERE id=?',
      )
        .bind(id)
        .first<Discount>();
      if (request.method === 'DELETE') {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM discount_codes WHERE id=?').bind(id),
          auditStatement(user, 'discount_deleted', id, old, null),
        ]);
        return json({ ok: true });
      }
      const code = text('code').toUpperCase(),
        kind = text('kind'),
        amount = Number(input.amount);
      const starts = text('starts_at') || null,
        expires = text('expires_at') || null;
      const max =
          input.max_uses === null || input.max_uses === ''
            ? null
            : Number(input.max_uses),
        per =
          input.per_user === null || input.per_user === ''
            ? null
            : Number(input.per_user);
      if (
        !/^[A-Z0-9_-]{2,40}$/.test(code) ||
        !['percent', 'fixed'].includes(kind) ||
        !Number.isInteger(amount) ||
        amount < 0 ||
        (kind === 'percent' && amount > 100) ||
        amount > 10000000 ||
        [max, per].some((x) => x !== null && (!Number.isInteger(x) || x < 1)) ||
        [starts, expires].some((x) => x && !Number.isFinite(Date.parse(x))) ||
        (starts && expires && starts >= expires)
      )
        throw new Error('Check code, discount amount, dates and usage limits.');
      const next = {
        code,
        kind,
        amount,
        enabled: input.enabled ? 1 : 0,
        starts,
        expires,
        max,
        per,
      };
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO discount_codes(id,code,kind,amount,enabled,starts_at,expires_at,max_uses,per_user,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,kind=excluded.kind,amount=excluded.amount,enabled=excluded.enabled,starts_at=excluded.starts_at,expires_at=excluded.expires_at,max_uses=excluded.max_uses,per_user=excluded.per_user,updated_at=excluded.updated_at',
        ).bind(
          id,
          code,
          kind,
          amount,
          next.enabled,
          starts,
          expires,
          max,
          per,
          new Date().toISOString(),
        ),
        auditStatement(
          user,
          old ? 'discount_updated' : 'discount_created',
          id,
          old,
          next,
        ),
      ]);
      return json({ ok: true });
    }
    if (action === 'subscriptions') {
      if (!root) return json({ error: 'Superadmin MFA required.' }, 403);
      await expireSubscriptions();
      if (request.method === 'GET') {
        const search = `%${(url.searchParams.get('search') || '').slice(0, 100)}%`,
          status = url.searchParams.get('status') || '',
          sort =
            url.searchParams.get('sort') === 'name'
              ? 'p.email'
              : 's.expires_at';
        const rows = await env.DB.prepare(
          `SELECT p.uid,p.email,json_extract(p.profile_json,'$.displayName') AS name,json_extract(p.profile_json,'$.tier') AS tier,s.* FROM profiles p LEFT JOIN subscriptions s ON s.user_id=p.uid WHERE (p.email LIKE ? OR json_extract(p.profile_json,'$.displayName') LIKE ? OR p.uid LIKE ?) AND (?='' OR coalesce(s.status,'none')=? OR json_extract(p.profile_json,'$.tier')=?) ORDER BY ${sort},p.uid LIMIT 51 OFFSET ?`,
        )
          .bind(
            search,
            search,
            search,
            status,
            status,
            status,
            Math.max(0, Number(url.searchParams.get('offset')) || 0),
          )
          .all();
        return json({ subscriptions: rows.results });
      }
      const member = await profileById(text('userId'));
      if (!member) throw new Error('User not found.');
      const old = await env.DB.prepare(
        'SELECT * FROM subscriptions WHERE user_id=?',
      )
        .bind(member.uid)
        .first();
      const profile = JSON.parse(member.profile_json) as MemberProfile;
      const cancel = text('operation') === 'cancel';
      const now = new Date().toISOString(),
        end = text('expires_at');
      if (!cancel && (!Number.isFinite(Date.parse(end)) || end <= now))
        throw new Error('Select a future expiration date.');
      const paid = Number(input.paid ?? 0);
      if (!Number.isInteger(paid) || paid < 0)
        throw new Error('Invalid paid amount.');
      const status = cancel ? 'cancelled' : 'manually_activated';
      const discounted =
        !cancel && text('code')
          ? await quote(
              {
                ...user,
                uid: profile.uid,
                email: profile.email,
                displayName: profile.displayName,
              },
              text('code'),
            )
          : null;
      if (discounted && paid !== discounted.final)
        throw new Error(
          `Final amount must equal ${discounted.final / 100} SAR for this code.`,
        );
      await env.DB.batch([
        ...(discounted
          ? [
              env.DB.prepare(
                'INSERT INTO subscription_events(id,user_id,email,name,admin_id,code_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              ).bind(
                crypto.randomUUID(),
                member.uid,
                profile.email,
                profile.displayName,
                user.uid,
                discounted.codeId,
                discounted.code,
                'discount_redeemed',
                discounted.original,
                discounted.discount,
                discounted.final,
                'success',
                now,
                end,
                now,
                'Administrator confirmed payment',
              ),
            ]
          : []),
        env.DB.prepare(
          `INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,discount_code,paid,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,starts_at=CASE WHEN subscriptions.status IN ('active','manually_activated') THEN coalesce(subscriptions.starts_at,excluded.starts_at) ELSE excluded.starts_at END,expires_at=excluded.expires_at,method=excluded.method,discount_code=excluded.discount_code,paid=excluded.paid,updated_at=excluded.updated_at`,
        ).bind(
          member.uid,
          status,
          now,
          cancel ? now : end,
          'manual',
          text('code') || (old?.discount_code as string | null) || null,
          paid,
          now,
        ),
        env.DB.prepare(
          "UPDATE profiles SET profile_json=json_set(profile_json,'$.tier',?),updated_at=? WHERE uid=?",
        ).bind(cancel ? 'lite' : 'pro', now, member.uid),
        env.DB.prepare(
          'INSERT INTO subscription_events(id,user_id,email,name,admin_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          crypto.randomUUID(),
          member.uid,
          profile.email,
          profile.displayName,
          user.uid,
          text('code') || null,
          cancel ? 'subscription_cancelled' : 'subscription_manually_activated',
          paid,
          0,
          paid,
          'success',
          now,
          cancel ? now : end,
          now,
          JSON.stringify({ previous: old }),
        ),
        auditStatement(
          user,
          cancel ? 'subscription_cancelled' : 'subscription_manually_activated',
          member.uid,
          old,
          { status, expires_at: end, paid },
        ),
      ]);
      return json({ ok: true });
    }
    if (action === 'question') {
      const number = (url.searchParams.get('id') || text('id'))
        .replace(/^#/, '')
        .padStart(5, '0');
      const row = await env.DB.prepare(
        "SELECT r.payload,q.uuid,q.created_at FROM question_registry q JOIN records r ON r.id=q.id AND r.type='sharedQuestions' WHERE q.question_id=?",
      )
        .bind(number)
        .first<{ payload: string; uuid: string; created_at: string }>();
      if (!row) return json({ error: 'Question not found' }, 404);
      const question = JSON.parse(row.payload) as Question;
      const state = await bankAccessState(question.qbankId ?? 'smle-gs');
      const bank = state.qbanks.find((x) => x.id === question.qbankId);
      if (
        !bank ||
        !(
          canAccessBank(user, bank, state.memberships) ||
          canReviewBank(user, bank, state.memberships)
        )
      )
        return json({ error: 'Question not found' }, 404);
      if (request.method === 'DELETE') {
        if (!canManageBank(user, bank))
          return json({ error: 'Bank manager required.' }, 403);
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM records WHERE type='sharedQuestions' AND id=?",
          ).bind(question.id),
          auditStatement(
            user,
            'question_deleted',
            '#deleted',
            { internalId: question.id },
            null,
          ),
        ]);
        return json({ ok: true });
      }
      return json({
        question,
        details: canReviewBank(user, bank, state.memberships)
          ? {
              bank: bank.name,
              creator: question.writtenByName ?? 'Qraft',
              createdAt: row.created_at,
              updatedAt: question.reviewedAt,
              status: 'approved',
            }
          : null,
      });
    }
    if (action === 'import' && request.method === 'POST') {
      const batchId = text('requestId');
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(batchId))
        throw new Error('Invalid import ID.');
      const previous = await env.DB.prepare(
        'SELECT user_id,result FROM import_batches WHERE id=?',
      )
        .bind(batchId)
        .first<{ user_id: string; result: string }>();
      if (previous)
        return previous.user_id === user.uid
          ? json(JSON.parse(previous.result))
          : json({ error: 'Invalid import ID.' }, 409);
      const state = await bankAccessState(text('qbankId'));
      const bank = state.qbanks.find((x) => x.id === text('qbankId'));
      if (!bank || !canAccessBank(user, bank, state.memberships))
        return json({ error: 'QBank access required.' }, 403);
      const drafts = parseQuestionImport(input.questions),
        now = new Date().toISOString();
      const proposals = drafts.map((payload, index) => ({
        id: `${batchId}-${index}`,
        qbankId: bank.id,
        type: 'new_question',
        editKinds: [
          'question_text',
          'options',
          'correct_answer',
          'explanation',
          'source',
        ],
        payload,
        rationale: 'Imported from JSON.',
        submissionMethod: 'json',
        importBatchId: batchId,
        status: 'pending',
        proposedById: user.uid,
        proposedByName: user.displayName,
        proposedAt: now,
      }));
      const result = {
        proposals,
        total: proposals.length,
        successful: proposals.length,
        failed: 0,
        errors: [],
      };
      await env.DB.batch([
        env.DB.prepare('INSERT INTO import_batches VALUES(?,?,?)').bind(
          batchId,
          user.uid,
          JSON.stringify(result),
        ),
        env.DB.prepare(
          "INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) SELECT 'questionProposals',json_extract(value,'$.id'),?,?,value,? FROM json_each(?)",
        ).bind(bank.id, user.uid, now, JSON.stringify(proposals)),
        auditStatement(user, 'questions_json_imported', bank.id, null, {
          batchId,
          count: proposals.length,
        }),
      ]);
      return json(result);
    }
    if (action === 'reviewers') {
      const bankId = url.searchParams.get('bank') || text('bankId');
      const state = await bankAccessState(bankId);
      const bank = state.qbanks.find((x) => x.id === bankId);
      if (!bank || !canManageBank(user, bank))
        return json({ error: 'Bank manager required.' }, 403);
      if (request.method === 'GET') {
        const search = (url.searchParams.get('search') || '').slice(0, 100);
        const rows = search
          ? await env.DB.prepare(
              "SELECT uid,email,json_extract(profile_json,'$.displayName') AS name FROM profiles WHERE json_extract(profile_json,'$.status')='approved' AND coalesce(json_extract(profile_json,'$.suspended'),0)=0 AND (email LIKE ? OR json_extract(profile_json,'$.displayName') LIKE ?) ORDER BY email LIMIT 10",
            )
              .bind(`%${search}%`, `%${search}%`)
              .all()
          : await env.DB.prepare(
              "SELECT p.uid,p.email,json_extract(p.profile_json,'$.displayName') AS name FROM profiles p JOIN records r ON r.type='qbankMemberships' AND json_extract(r.payload,'$.userId')=p.uid WHERE json_extract(r.payload,'$.role')='reviewer' AND json_extract(r.payload,'$.grantedById')=? GROUP BY p.uid ORDER BY max(r.updated_at) DESC LIMIT 10",
            )
              .bind(user.uid)
              .all();
        return json({ users: rows.results });
      }
      const target = await profileById(text('userId'));
      if (!target) throw new Error('User not found.');
      const profile = JSON.parse(target.profile_json) as MemberProfile;
      if (profile.status !== 'approved' || profile.suspended)
        throw new Error('User is not active.');
      if (
        bank.ownerId === profile.uid ||
        state.memberships.some(
          (x) =>
            x.qbankId === bank.id &&
            x.userId === profile.uid &&
            x.role === 'reviewer',
        )
      )
        throw new Error('This reviewer is already added.');
      const now = new Date().toISOString();
      const membership = {
        id: `reviewer-${bank.id}-${profile.uid}`,
        qbankId: bank.id,
        userId: profile.uid,
        userName: profile.displayName,
        role: 'reviewer',
        grantedById: user.uid,
        grantedByName: user.displayName,
        createdAt: now,
      };
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM records WHERE type='qbankMemberships' AND qbank_id=? AND json_extract(payload,'$.userId')=?",
        ).bind(bank.id, profile.uid),
        env.DB.prepare(
          "INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES('qbankMemberships',?,?,?,?,?)",
        ).bind(
          membership.id,
          bank.id,
          user.uid,
          JSON.stringify(membership),
          now,
        ),
        auditStatement(user, 'reviewer_added', bank.id, null, {
          userId: profile.uid,
        }),
      ]);
      return json({ membership });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error && !error.message.includes('D1_')
            ? error.message
            : 'The change could not be saved. Check the values and try again.',
      },
      400,
    );
  }
}

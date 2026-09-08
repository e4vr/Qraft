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
  optionLabel,
  type AppUser,
  type MemberProfile,
  type Question,
  type QuestionProposal,
} from './medguard-types';
import { parseQuestionImportReport } from './question-import';
import { bankAccessState } from './qbank-access-repository';
import { allocateQuestionIds } from './question-id-repository';
import { getEffectiveEntitlement } from './entitlement-server';
import {
  ABUSE_LIMITS,
  CONTRIBUTION_CREDITS,
  REWARD_CATALOG,
  contributionBadge,
  getPlanLimits,
  isPlanId,
  utcDayStart,
  utcMonthStart,
  type PlanId,
} from './plan-config';

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
      `INSERT INTO records(type,id,owner_id,payload,updated_at) SELECT 'auditLog','expired-'||user_id||'-'||expires_at,user_id,json_object('id','expired-'||user_id||'-'||expires_at,'action','subscription_expired','entityType','account','entityId',user_id,'actorId','system','actorName','Qraft','createdAt',?,'detail','Subscription expired; effective access returned to the remaining entitlement.'),? FROM subscriptions WHERE status IN ('active','manually_activated') AND expires_at<=? ON CONFLICT(type,id) DO NOTHING`,
    ).bind(now, now, now),
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
  allowed_plans: string;
};
async function quote(user: AppUser, code: string, requestedPlan: PlanId = 'pro') {
  if (requestedPlan === 'free') throw new Error('Choose a paid plan.');
  const configured = await env.DB.prepare(
    'SELECT price_sar_year FROM plan_prices WHERE plan=?',
  )
    .bind(requestedPlan)
    .first<{ price_sar_year: number }>();
  const original = (configured?.price_sar_year ?? getPlanLimits(requestedPlan).priceSarYear) * 100;
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
    const allowedPlans = JSON.parse(discount.allowed_plans || '[]') as unknown[];
    if (!allowedPlans.includes(requestedPlan))
      throw new Error('This code is not valid for the selected plan.');
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
    plan: requestedPlan,
  };
}

function addRewardDuration(
  startedAt: string,
  duration: number,
  unit: 'month' | 'year',
) {
  const expiry = new Date(startedAt);
  if (unit === 'month') expiry.setUTCMonth(expiry.getUTCMonth() + duration);
  else expiry.setUTCFullYear(expiry.getUTCFullYear() + duration);
  return expiry.toISOString();
}

function normalizeQuestionText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/^\s*(?:q(?:uestion)?\s*)?\d+[.)\-:]\s*/i, '')
    .replace(/[“”‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(left: string, right: string) {
  const a = new Set(normalizeQuestionText(left).split(' ').filter(Boolean));
  const b = new Set(normalizeQuestionText(right).split(' ').filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

function contributionReward(proposal: QuestionProposal) {
  if (proposal.type === 'new_question')
    return { amount: CONTRIBUTION_CREDITS.newQuestion, reason: 'New approved question' };
  if (proposal.editKinds.includes('correct_answer'))
    return {
      amount: CONTRIBUTION_CREDITS.medicalFactOrCorrectAnswer,
      reason: 'Corrected wrong answer or medical fact',
    };
  if (proposal.editKinds.includes('question_text') || proposal.editKinds.includes('options'))
    return {
      amount: CONTRIBUTION_CREDITS.substantialCorrection,
      reason: 'Substantial question correction',
    };
  if (proposal.editKinds.includes('explanation'))
    return {
      amount: CONTRIBUTION_CREDITS.explanationImprovement,
      reason: 'Useful explanation improvement',
    };
  if (proposal.editKinds.includes('source'))
    return {
      amount: CONTRIBUTION_CREDITS.sourceReference,
      reason: 'Valid source or reference',
    };
  return {
    amount: CONTRIBUTION_CREDITS.typoFormatting,
    reason: 'Typo or formatting correction',
  };
}

function proposalRequiresTwoReviewers(proposal: QuestionProposal) {
  return (
    proposal.type === 'question_edit' &&
    (proposal.editKinds.includes('correct_answer') ||
      (!proposal.editKinds.includes('typo_formatting') &&
        (proposal.editKinds.includes('question_text') ||
          proposal.editKinds.includes('options'))))
  );
}

async function sha256Text(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function recordConfirmedDuplicateAttempt(
  user: AppUser,
  kind: 'file' | 'question',
  contentHash: string,
  referenceId?: string,
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO duplicate_attempts(id,user_id,kind,content_hash,reference_id,confirmed,created_at,metadata) VALUES(?,?,?,?,?,1,?,'{}')",
  ).bind(crypto.randomUUID(), user.uid, kind, contentHash, referenceId ?? null, now).run();
  const windowStart = new Date(
    Date.now() - ABUSE_LIMITS.rollingWindowDays * 86_400_000,
  ).toISOString();
  const count = await env.DB.prepare(
    'SELECT count(*) AS value FROM duplicate_attempts WHERE user_id=? AND confirmed=1 AND created_at>=?',
  ).bind(user.uid, windowStart).first<{ value: number }>();
  if ((count?.value ?? 0) < ABUSE_LIMITS.confirmedDuplicateAttempts) return null;
  const active = await env.DB.prepare(
    'SELECT ends_at FROM json_import_suspensions WHERE user_id=? AND removed_at IS NULL AND ends_at>? LIMIT 1',
  ).bind(user.uid, now).first<{ ends_at: string }>();
  if (active) return active.ends_at;
  const endsAt = new Date(
    Date.now() + ABUSE_LIMITS.jsonImportSuspensionDays * 86_400_000,
  ).toISOString();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO contribution_accounts(user_id,credits_balance,lifetime_score,trust_score,updated_at)
      VALUES(?,0,0,90,?)
      ON CONFLICT(user_id) DO UPDATE SET trust_score=max(0,contribution_accounts.trust_score-10),updated_at=excluded.updated_at`)
      .bind(user.uid, now),
    env.DB.prepare(
      'INSERT INTO json_import_suspensions(id,user_id,reason,starts_at,ends_at,created_by) VALUES(?,?,?,?,?,?)',
    ).bind(
      id,
      user.uid,
      `${ABUSE_LIMITS.confirmedDuplicateAttempts} confirmed duplicate attempts within ${ABUSE_LIMITS.rollingWindowDays} days`,
      now,
      endsAt,
      'system',
    ),
    auditStatement(user, 'json_import_auto_suspended', user.uid, null, {
      reason: 'confirmed_duplicate_abuse',
      endsAt,
    }),
  ]);
  return endsAt;
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
    if (action === 'plan-status' && request.method === 'GET') {
      const plan = user.effectivePlan ?? user.tier;
      const limits = getPlanLimits(plan);
      const monthStart = utcMonthStart();
      const dayStart = utcDayStart();
      const [lifetime, monthly, imports, pending, media] = await env.DB.batch([
        env.DB.prepare('SELECT count(*) AS value FROM test_registry WHERE user_id=?').bind(user.uid),
        env.DB.prepare('SELECT count(*) AS value FROM test_registry WHERE user_id=? AND started_at>=?').bind(user.uid, monthStart),
        env.DB.prepare('SELECT count(*) AS value FROM imported_files WHERE user_id=? AND uploaded_at>=?').bind(user.uid, dayStart),
        env.DB.prepare("SELECT count(*) AS value FROM records WHERE type='questionProposals' AND owner_id=? AND json_extract(payload,'$.status')='pending'").bind(user.uid),
        env.DB.prepare("SELECT coalesce(sum(size),0) AS value FROM media WHERE owner_id=? AND status='ready'").bind(user.uid),
      ]);
      const value = (result: D1Result<unknown>) => Number((result.results[0] as { value?: number } | undefined)?.value ?? 0);
      return json({
        plan,
        limits,
        usage: {
          lifetimeStartedExams: value(lifetime),
          monthlyStartedExams: value(monthly),
          dailyJsonImports: value(imports),
          pendingReviewQuestions: value(pending),
          activeImageStorageBytes: value(media),
        },
      });
    }
    if (action === 'exam-start' && request.method === 'POST') {
      const testId = text('testId');
      const questionCount = Number(input.questionCount);
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(testId) || !Number.isInteger(questionCount) || questionCount < 1)
        return json({ error: 'Invalid exam start request.' }, 400);
      const existing = await env.DB.prepare(
        'SELECT question_count,started_at FROM test_registry WHERE user_id=? AND test_id=?',
      ).bind(user.uid, testId).first<{ question_count: number; started_at: string }>();
      if (existing)
        return existing.question_count === questionCount
          ? json({ started: true, startedAt: existing.started_at, duplicate: true })
          : json({ error: 'This exam ID was already used.' }, 409);
      const plan = user.effectivePlan ?? user.tier;
      const limits = getPlanLimits(plan);
      if (questionCount > limits.maxQuestionsPerExam)
        return json({ error: `${limits.name} allows ${limits.maxQuestionsPerExam} questions per exam.` }, 403);
      const now = new Date().toISOString();
      const lifetimeLimit = limits.lifetimeExamLimit ?? -1;
      const monthlyLimit = limits.monthlyExamLimit ?? -1;
      const inserted = await env.DB.prepare(`INSERT INTO test_registry(user_id,test_id,question_count,started_at)
        SELECT ?,?,?,?
        WHERE (?<0 OR (SELECT count(*) FROM test_registry WHERE user_id=?)<?)
          AND (?<0 OR (SELECT count(*) FROM test_registry WHERE user_id=? AND started_at>=?)<?)`)
        .bind(
          user.uid,
          testId,
          questionCount,
          now,
          lifetimeLimit,
          user.uid,
          lifetimeLimit,
          monthlyLimit,
          user.uid,
          utcMonthStart(),
          monthlyLimit,
        )
        .run();
      if (!inserted.meta.changes) {
        const counts = await env.DB.batch([
          env.DB.prepare('SELECT count(*) AS value FROM test_registry WHERE user_id=?').bind(user.uid),
          env.DB.prepare('SELECT count(*) AS value FROM test_registry WHERE user_id=? AND started_at>=?').bind(user.uid, utcMonthStart()),
        ]);
        const lifetime = Number((counts[0].results[0] as { value?: number } | undefined)?.value ?? 0);
        const monthly = Number((counts[1].results[0] as { value?: number } | undefined)?.value ?? 0);
        return json(
          {
            error:
              limits.lifetimeExamLimit !== null && lifetime >= limits.lifetimeExamLimit
                ? "You've reached your lifetime exam limit."
                : "You've reached your monthly exam limit.",
            usage: { lifetimeStartedExams: lifetime, monthlyStartedExams: monthly },
          },
          403,
        );
      }
      return json({ started: true, startedAt: now }, 201);
    }
    if (action === 'contributions' && request.method === 'GET') {
      const [account, transactions, passes, pending, submissions] = await env.DB.batch([
        env.DB.prepare('SELECT credits_balance,lifetime_score FROM contribution_accounts WHERE user_id=?').bind(user.uid),
        env.DB.prepare('SELECT id,amount,type,reason,reference_type,reference_id,created_at FROM credit_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 30').bind(user.uid),
        env.DB.prepare('SELECT id,plan,duration,duration_unit,status,created_at,activated_at,expires_at,source FROM reward_passes WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.uid),
        env.DB.prepare("SELECT count(*) AS value FROM records WHERE type='questionProposals' AND owner_id=? AND json_extract(payload,'$.status')='pending'").bind(user.uid),
        env.DB.prepare("SELECT id,json_extract(payload,'$.status') AS status,json_extract(payload,'$.type') AS type,updated_at FROM records WHERE type='questionProposals' AND owner_id=? AND json_extract(payload,'$.status')<>'approved' ORDER BY updated_at DESC LIMIT 20").bind(user.uid),
      ]);
      const summary = (account.results[0] as { credits_balance?: number; lifetime_score?: number } | undefined) ?? {};
      const score = Number(summary.lifetime_score ?? 0);
      return json({
        creditsBalance: Number(summary.credits_balance ?? 0),
        lifetimeContributionScore: score,
        badge: contributionBadge(score) ?? null,
        pendingSubmissions: Number((pending.results[0] as { value?: number } | undefined)?.value ?? 0),
        transactions: transactions.results,
        rewardPasses: passes.results,
        submissions: submissions.results,
        rewards: REWARD_CATALOG,
      });
    }
    if (action === 'rewards') {
      if (request.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT id,plan,duration,duration_unit,status,created_at,activated_at,expires_at,source FROM reward_passes WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
        ).bind(user.uid).all();
        return json({ rewards: REWARD_CATALOG, passes: rows.results });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const operation = text('operation');
      if (operation === 'redeem') {
        const requestId = text('requestId');
        const reward = REWARD_CATALOG.find((item) => item.id === text('rewardId'));
        if (!reward || !/^[a-zA-Z0-9-]{20,80}$/.test(requestId))
          return json({ error: 'Invalid reward request.' }, 400);
        const passId = `reward-${requestId}`;
        const prior = await env.DB.prepare('SELECT * FROM reward_passes WHERE id=? AND user_id=?')
          .bind(passId, user.uid).first();
        if (prior) return json({ pass: prior, duplicate: true });
        const now = new Date().toISOString();
        try {
          await env.DB.batch([
            env.DB.prepare('INSERT INTO credit_transactions(id,user_id,amount,lifetime_delta,type,reason,reference_type,reference_id,created_by,created_at,metadata) VALUES(?,?,?,0,?,?,?,?,?,?,?)')
              .bind(requestId, user.uid, -reward.credits, 'reward_redemption', `Redeemed ${reward.id}`, 'reward', requestId, user.uid, now, JSON.stringify({ rewardId: reward.id })),
            env.DB.prepare("INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,status,created_at,source,credit_transaction_id,metadata) VALUES(?,?,?,?,?,'available',?,'credits',?,?)")
              .bind(passId, user.uid, reward.plan, reward.duration, reward.durationUnit, now, requestId, JSON.stringify({ rewardId: reward.id })),
            auditStatement(user, 'reward_redeemed', passId, null, { rewardId: reward.id, credits: reward.credits }),
          ]);
        } catch (error) {
          const recovered = await env.DB.prepare('SELECT * FROM reward_passes WHERE id=? AND user_id=?')
            .bind(passId, user.uid).first();
          if (recovered) return json({ pass: recovered, duplicate: true });
          if (String(error).includes('INSUFFICIENT_CREDITS'))
            return json({ error: 'You do not have enough credits for this reward.' }, 409);
          throw error;
        }
        const pass = await env.DB.prepare('SELECT * FROM reward_passes WHERE id=?').bind(passId).first();
        return json({ pass }, 201);
      }
      if (operation === 'activate') {
        const passId = text('passId');
        const pass = await env.DB.prepare(
          "SELECT id,plan,duration,duration_unit,status FROM reward_passes WHERE id=? AND user_id=?",
        ).bind(passId, user.uid).first<{ id: string; plan: PlanId; duration: number; duration_unit: 'month' | 'year'; status: string }>();
        if (!pass) return json({ error: 'Reward pass not found.' }, 404);
        if (pass.status !== 'available')
          return json({ error: 'This reward pass is no longer available.' }, 409);
        const now = new Date().toISOString();
        const expiresAt = addRewardDuration(now, pass.duration, pass.duration_unit);
        const activated = await env.DB.prepare(
          "UPDATE reward_passes SET status='active',activated_at=?,expires_at=? WHERE id=? AND user_id=? AND status='available'",
        ).bind(now, expiresAt, passId, user.uid).run();
        if (!activated.meta.changes)
          return json({ error: 'This reward pass was already activated.' }, 409);
        await env.DB.batch([
          auditStatement(user, 'reward_activated', passId, null, { plan: pass.plan, expiresAt }),
          env.DB.prepare("UPDATE reward_passes SET status='expired' WHERE user_id=? AND status='active' AND expires_at<=?").bind(user.uid, now),
        ]);
        const entitlement = await getEffectiveEntitlement(user);
        return json({ activated: true, expiresAt, effectivePlan: entitlement.effectivePlan });
      }
      return json({ error: 'Invalid reward operation.' }, 400);
    }
    if (action === 'economy-admin') {
      if (!root) return json({ error: 'Superadmin MFA required.' }, 403);
      const targetUserId = url.searchParams.get('userId') || text('userId');
      if (!targetUserId) return json({ error: 'Choose a user.' }, 400);
      if (request.method === 'GET') {
        const [account, ledger, passes, suspensions, reviews, collusionFlags, contributionHistory] = await env.DB.batch([
          env.DB.prepare('SELECT * FROM contribution_accounts WHERE user_id=?').bind(targetUserId),
          env.DB.prepare('SELECT * FROM credit_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(targetUserId),
          env.DB.prepare('SELECT * FROM reward_passes WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(targetUserId),
          env.DB.prepare('SELECT * FROM json_import_suspensions WHERE user_id=? ORDER BY starts_at DESC LIMIT 50').bind(targetUserId),
          env.DB.prepare('SELECT * FROM contribution_reviews WHERE author_id=? OR reviewer_id=? ORDER BY created_at DESC LIMIT 100').bind(targetUserId, targetUserId),
          env.DB.prepare(`SELECT reviewer_id,author_id,count(*) AS approvals,
            round(100.0*count(*)/(SELECT count(*) FROM contribution_reviews total WHERE total.reviewer_id=contribution_reviews.reviewer_id AND total.decision='approved'),1) AS percentage
            FROM contribution_reviews WHERE decision='approved' AND (reviewer_id=? OR author_id=?)
            GROUP BY reviewer_id,author_id
            HAVING count(*)>=5 AND percentage>=80`).bind(targetUserId, targetUserId),
          env.DB.prepare("SELECT id,json_extract(payload,'$.status') AS status,json_extract(payload,'$.type') AS type,updated_at FROM records WHERE type='questionProposals' AND owner_id=? ORDER BY updated_at DESC LIMIT 100").bind(targetUserId),
        ]);
        return json({ account: account.results[0] ?? null, ledger: ledger.results, rewardHistory: passes.results, duplicateAbuse: suspensions.results, reviewerActivity: reviews.results, collusionFlags: collusionFlags.results, contributionHistory: contributionHistory.results });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const operation = text('operation');
      const reason = text('reason');
      if (!reason) return json({ error: 'A reason is required.' }, 400);
      const now = new Date().toISOString();
      if (operation === 'adjust-credits') {
        const amount = Number(input.amount);
        if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000)
          return json({ error: 'Enter a non-zero whole credit amount.' }, 400);
        const id = text('requestId') || crypto.randomUUID();
        try {
          await env.DB.batch([
            env.DB.prepare('INSERT INTO credit_transactions(id,user_id,amount,lifetime_delta,type,reason,reference_type,reference_id,created_by,created_at,metadata) VALUES(?,?,?,0,?,?,?,?,?,?,?)')
              .bind(id, targetUserId, amount, 'admin_adjustment', reason, 'admin', id, user.uid, now, '{}'),
            auditStatement(user, 'credit_adjustment', targetUserId, null, { amount, reason, transactionId: id }),
          ]);
        } catch (error) {
          if (String(error).includes('INSUFFICIENT_CREDITS'))
            return json({ error: 'This adjustment would make the balance negative.' }, 409);
          if (String(error).includes('UNIQUE constraint')) return json({ ok: true, duplicate: true });
          throw error;
        }
        return json({ ok: true });
      }
      if (operation === 'grant-reward') {
        const plan = text('plan');
        const duration = Number(input.duration ?? 1);
        const durationUnit = text('durationUnit') || 'month';
        if (!isPlanId(plan) || plan === 'free' || !Number.isInteger(duration) || duration < 1 || duration > 24 || !['month', 'year'].includes(durationUnit))
          return json({ error: 'Invalid reward pass.' }, 400);
        const id = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare("INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,status,created_at,source,metadata) VALUES(?,?,?,?,?,'available',?,'admin',?)")
            .bind(id, targetUserId, plan, duration, durationUnit, now, JSON.stringify({ reason, grantedBy: user.uid })),
          auditStatement(user, 'reward_granted', targetUserId, null, { passId: id, plan, duration, durationUnit, reason }),
        ]);
        return json({ ok: true, passId: id });
      }
      if (operation === 'suspend-json') {
        const days = Number(input.days ?? ABUSE_LIMITS.jsonImportSuspensionDays);
        if (!Number.isInteger(days) || days < 1 || days > 365)
          return json({ error: 'Invalid suspension duration.' }, 400);
        const endsAt = new Date(Date.now() + days * 86_400_000).toISOString();
        const id = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare('INSERT INTO json_import_suspensions(id,user_id,reason,starts_at,ends_at,created_by) VALUES(?,?,?,?,?,?)')
            .bind(id, targetUserId, reason, now, endsAt, user.uid),
          auditStatement(user, 'json_import_suspended', targetUserId, null, { id, reason, endsAt }),
        ]);
        return json({ ok: true, endsAt });
      }
      if (operation === 'remove-json-suspension') {
        await env.DB.batch([
          env.DB.prepare('UPDATE json_import_suspensions SET removed_at=?,removed_by=? WHERE user_id=? AND removed_at IS NULL AND ends_at>?')
            .bind(now, user.uid, targetUserId, now),
          auditStatement(user, 'json_import_suspension_removed', targetUserId, null, { reason }),
        ]);
        return json({ ok: true });
      }
      return json({ error: 'Invalid admin operation.' }, 400);
    }
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

      const reviewRows = await env.DB.prepare(
        "SELECT proposal_id,reviewer_id,decision FROM contribution_reviews WHERE proposal_id IN (SELECT value FROM json_each(?))",
      ).bind(JSON.stringify(proposalIds)).all<{ proposal_id: string; reviewer_id: string; decision: string }>();
      if (reviewRows.results.some((review) => review.reviewer_id === user.uid))
        return json({ error: 'You have already reviewed one or more selected submissions.' }, 409);
      const highRisk = new Set(
        proposals
          .filter(proposalRequiresTwoReviewers)
          .map((proposal) => proposal.id),
      );
      const awaitingSecond = new Set<string>();
      if (status === 'approved') {
        for (const proposal of proposals) {
          if (
            highRisk.has(proposal.id) &&
            !reviewRows.results.some(
              (review) => review.proposal_id === proposal.id && review.decision === 'approved',
            )
          )
            awaitingSecond.add(proposal.id);
        }
      }
      const proposalsToFinalize = proposals.filter(
        (proposal) => !awaitingSecond.has(proposal.id),
      );

      const existingIds = [...new Set(proposalsToFinalize.filter(proposal => proposal.type === 'question_edit').map(proposal => proposal.questionId).filter((id): id is string => Boolean(id)))];
      const existingRows = existingIds.length
        ? await env.DB.prepare("SELECT id,payload FROM records WHERE type='sharedQuestions' AND id IN (SELECT value FROM json_each(?))")
            .bind(JSON.stringify(existingIds)).all<{ id: string; payload: string }>()
        : { results: [] as Array<{ id: string; payload: string }> };
      const existingQuestions = new Map(existingRows.results.map(row => [row.id, JSON.parse(row.payload) as Question]));
      if (proposalsToFinalize.some(proposal => proposal.type === 'question_edit' && (!proposal.questionId || !existingQuestions.has(proposal.questionId))))
        return json({ error: 'A question changed or was deleted while you were reviewing it. Refresh and try again.' }, 409);

      const reservedByBank = new Map<string, string[]>();
      if (status === 'approved') {
        for (const bankId of new Set(proposalsToFinalize.filter(proposal => proposal.type === 'new_question').map(proposal => proposal.qbankId))) {
          const count = proposalsToFinalize.filter(proposal => proposal.type === 'new_question' && proposal.qbankId === bankId).length;
          const allocated = await allocateQuestionIds(count, bankId, user.uid);
          if (allocated.length !== count) return json({ error: 'Question ID capacity reached.' }, 409);
          reservedByBank.set(bankId, allocated);
        }
      }

      const now = new Date().toISOString();
      const nextNumbers = new Map<string, number>();
      if (status === 'approved') {
        for (const bankId of new Set(proposalsToFinalize.map(proposal => proposal.qbankId))) {
          const maximum = await env.DB.prepare("SELECT coalesce(max(CAST(json_extract(payload,'$.number') AS INTEGER)),0) AS value FROM records WHERE type='sharedQuestions' AND qbank_id=?")
            .bind(bankId).first<{ value: number }>();
          nextNumbers.set(bankId, maximum?.value ?? 0);
        }
      }
      const statements: D1PreparedStatement[] = [];
      for (const proposal of proposals.filter((item) => awaitingSecond.has(item.id))) {
        statements.push(
          env.DB.prepare(
            "INSERT INTO contribution_reviews(id,proposal_id,author_id,reviewer_id,decision,high_risk,created_at,metadata) VALUES(?,?,?,?, 'approved',1,?,?)",
          ).bind(
            crypto.randomUUID(),
            proposal.id,
            proposal.proposedById,
            user.uid,
            now,
            JSON.stringify({ awaitingSecondReviewer: true }),
          ),
          auditStatement(user, 'high_risk_review_first_approval', proposal.id, null, {
            authorId: proposal.proposedById,
            awaitingSecondReviewer: true,
          }),
        );
      }
      for (const proposal of proposalsToFinalize) {
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
        statements.push(
          env.DB.prepare(
            'INSERT INTO contribution_reviews(id,proposal_id,author_id,reviewer_id,decision,high_risk,created_at,metadata) VALUES(?,?,?,?,?,?,?,?)',
          ).bind(
            crypto.randomUUID(),
            proposal.id,
            proposal.proposedById,
            user.uid,
            status,
            highRisk.has(proposal.id) ? 1 : 0,
            now,
            '{}',
          ),
        );
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
            sourcePage: proposal.payload.sourcePage ?? existing?.sourcePage ?? 0,
            sourceFile: proposal.payload.sourceFile ?? existing?.sourceFile ?? proposal.payload.sourceReference,
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
          const reward = contributionReward(proposal);
          statements.push(
            env.DB.prepare(
              'INSERT OR IGNORE INTO credit_transactions(id,user_id,amount,lifetime_delta,type,reason,reference_type,reference_id,created_by,created_at,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            ).bind(
              `contribution-${proposal.id}`,
              proposal.proposedById,
              reward.amount,
              reward.amount,
              'approved_contribution',
              reward.reason,
              'questionProposal',
              proposal.id,
              user.uid,
              now,
              JSON.stringify({ editKinds: proposal.editKinds, qbankId: proposal.qbankId }),
            ),
          );
        }
      }
      statements.push(auditStatement(user, `questions_bulk_${status}`, crypto.randomUUID(), null, {
        count: proposals.length,
        proposalIds,
        submitters: [...new Set(proposals.map(proposal => proposal.proposedById))],
      }));
      await env.DB.batch(statements);
      return json({
        ok: true,
        reviewed: proposalsToFinalize.length,
        awaitingSecondReview: awaitingSecond.size,
      });
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
    if (action === 'quote' && request.method === 'POST') {
      const requestedPlan = text('plan');
      return json(
        await quote(
          user,
          text('code'),
          isPlanId(requestedPlan) && requestedPlan !== 'free'
            ? requestedPlan
            : 'pro',
        ),
      );
    }
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
      const requestedPlan = text('plan');
      const plan = isPlanId(requestedPlan) && requestedPlan !== 'free' ? requestedPlan : 'pro';
      if ((user.effectivePlan ?? user.tier) === plan)
        return json({ error: `Your account is already ${getPlanLimits(plan).name}.` }, 409);
      const price = await quote(user, text('code'), plan);
      const now = new Date().toISOString();
      const end = new Date(now);
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      if (price.final === 0 && price.codeId) {
        try {
          await env.DB.batch([
            env.DB.prepare(
              'INSERT INTO subscription_events(id,user_id,email,name,code_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail,plan) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
              `One year ${getPlanLimits(plan).name}`,
              plan,
            ),
            auditStatement(
              user,
              'discount_redeemed',
              user.uid,
              { tier: user.effectivePlan ?? user.tier },
              {
                tier: plan,
                ...price,
                startsAt: now,
                expiresAt: end.toISOString(),
              },
            ),
          ]);
        } catch {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO subscription_events(id,user_id,email,name,code_id,code,action,original,discount,final,status,created_at,detail,plan) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
              plan,
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
      const message = `أرغب بالاشتراك في Qraft ${getPlanLimits(plan).name} لمدة سنة.\nName: ${user.displayName}\nEmail: ${user.email}\nUser ID: ${user.uid}\nOriginal: ${price.original / 100} SAR\nCode: ${price.code || 'None'}\nDiscount: ${price.discount / 100} SAR\nFinal: ${price.final / 100} SAR`;
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
      const allowedPlans = Array.isArray(input.allowedPlans)
        ? [...new Set(input.allowedPlans.filter((plan): plan is PlanId => isPlanId(plan) && plan !== 'free'))]
        : old
          ? (JSON.parse(old.allowed_plans || '[]') as PlanId[])
          : ['lite', 'pro', 'unlimited'];
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
        || !allowedPlans.length
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
        allowedPlans,
      };
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO discount_codes(id,code,kind,amount,enabled,starts_at,expires_at,max_uses,per_user,updated_at,allowed_plans) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,kind=excluded.kind,amount=excluded.amount,enabled=excluded.enabled,starts_at=excluded.starts_at,expires_at=excluded.expires_at,max_uses=excluded.max_uses,per_user=excluded.per_user,updated_at=excluded.updated_at,allowed_plans=excluded.allowed_plans',
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
          JSON.stringify(allowedPlans),
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
      const requestedPlan = text('plan');
      const subscriptionPlan = isPlanId(requestedPlan) && requestedPlan !== 'free' ? requestedPlan : 'pro';
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
              subscriptionPlan,
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
                'INSERT INTO subscription_events(id,user_id,email,name,admin_id,code_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail,plan) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
                subscriptionPlan,
              ),
            ]
          : []),
        env.DB.prepare(
          `INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,discount_code,paid,updated_at,plan) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,starts_at=CASE WHEN subscriptions.status IN ('active','manually_activated') THEN coalesce(subscriptions.starts_at,excluded.starts_at) ELSE excluded.starts_at END,expires_at=excluded.expires_at,method=excluded.method,discount_code=excluded.discount_code,paid=excluded.paid,updated_at=excluded.updated_at,plan=excluded.plan`,
        ).bind(
          member.uid,
          status,
          now,
          cancel ? now : end,
          'manual',
          text('code') || (old?.discount_code as string | null) || null,
          paid,
          now,
          subscriptionPlan,
        ),
        env.DB.prepare(
          'INSERT INTO subscription_events(id,user_id,email,name,admin_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail,plan) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
          subscriptionPlan,
        ),
        auditStatement(
          user,
          cancel ? 'subscription_cancelled' : 'subscription_manually_activated',
          member.uid,
          old,
          { status, expires_at: end, paid, plan: subscriptionPlan },
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
      const plan = user.effectivePlan ?? user.tier;
      const limits = getPlanLimits(plan);
      if (!limits.canUseJsonImport)
        return json({ error: 'JSON Import is available with Pro.' }, 403);
      if (input.rightsConfirmed === false)
        return json(
          { error: 'Confirm that you have the right to share this content.' },
          400,
        );
      const now = new Date().toISOString();
      const suspension = await env.DB.prepare(
        'SELECT ends_at,reason FROM json_import_suspensions WHERE user_id=? AND removed_at IS NULL AND starts_at<=? AND ends_at>? ORDER BY ends_at DESC LIMIT 1',
      ).bind(user.uid, now, now).first<{ ends_at: string; reason: string }>();
      if (suspension)
        return json(
          { error: `JSON Import is suspended until ${suspension.ends_at}.` },
          403,
        );
      const dailyImports = await env.DB.prepare(
        'SELECT count(*) AS value FROM imported_files WHERE user_id=? AND uploaded_at>=?',
      ).bind(user.uid, utcDayStart()).first<{ value: number }>();
      if ((dailyImports?.value ?? 0) >= limits.jsonImportDailyLimit)
        return json(
          { error: `You've reached your daily JSON import limit (${limits.jsonImportDailyLimit}).` },
          403,
        );
      const state = await bankAccessState(text('qbankId'));
      const bank = state.qbanks.find((x) => x.id === text('qbankId'));
      if (!bank || !canAccessBank(user, bank, state.memberships) || !limits.canAddQuestions)
        return json({ error: 'Question contribution access requires Pro.' }, 403);
      const uploadedFileName = text('fileName').split(/[\\/]/).pop()?.trim().slice(0, 240) ?? '';
      const normalizedName = uploadedFileName.toLocaleLowerCase('en-US');
      const fileHash = text('fileHash').toLowerCase();
      if (!uploadedFileName || !/^[a-f0-9]{64}$/.test(fileHash))
        return json({ error: 'اسم الملف أو بصمته غير صالح.' }, 400);
      const duplicate = await env.DB.prepare(
        'SELECT file_name FROM imported_files WHERE user_id=? AND (normalized_name=? OR file_hash=?) LIMIT 1',
      ).bind(user.uid, normalizedName, fileHash).first<{ file_name: string }>();
      if (duplicate) {
        const suspendedUntil = await recordConfirmedDuplicateAttempt(
          user,
          'file',
          fileHash,
          duplicate.file_name,
        );
        return json({
          error: suspendedUntil
            ? `هذا الملف مكرر. تم تعليق JSON Import حتى ${suspendedUntil}.`
            : 'هذا الملف تم رفعه مسبقًا. الأسئلة المستخرجة منه إما تحت المراجعة أو تمت معالجتها بالفعل، لذلك لا تحتاج إلى رفع الملف مرة أخرى. لرفع نسخة محدثة يجب أن يكون محتواها واسمها مختلفين.',
          suspendedUntil,
        }, 409);
      }
      const rawImport = typeof input.questions === 'string'
        ? input.questions
        : { sourceFile: text('sourceFile'), questions: input.questions, skipped: input.skipped };
      const report = parseQuestionImportReport(rawImport);
      if (!report.questions.length)
        return json({ error: 'لم يتم العثور على أي سؤال مكتمل وصالح للاستيراد.', skipped: report.skipped }, 400);
      if (report.questions.length > limits.jsonQuestionsPerImport)
        return json(
          { error: `${limits.name} allows at most ${limits.jsonQuestionsPerImport} questions per JSON import.` },
          403,
        );
      const candidateRows = await env.DB.prepare(
        "SELECT id,type,payload FROM records WHERE qbank_id=? AND type IN ('sharedQuestions','questionProposals') AND (type='sharedQuestions' OR json_extract(payload,'$.status')='pending')",
      ).bind(bank.id).all<{ id: string; type: string; payload: string }>();
      const candidates = candidateRows.results.map((row) => {
        const parsed = JSON.parse(row.payload) as Question | QuestionProposal;
        const payload = row.type === 'questionProposals'
          ? (parsed as QuestionProposal).payload
          : (parsed as Question);
        return {
          id: row.id,
          stem: payload.stem,
          key: `${normalizeQuestionText(payload.stem)}|${payload.options.map(normalizeQuestionText).join('|')}`,
        };
      });
      const accepted: Array<{
        payload: QuestionProposal['payload'];
        duplicateInfo?: QuestionProposal['duplicateInfo'];
      }> = [];
      const duplicateSkips = [] as typeof report.skipped;
      for (const payload of report.questions) {
        const key = `${normalizeQuestionText(payload.stem)}|${payload.options.map(normalizeQuestionText).join('|')}`;
        const exact = [
          ...candidates,
          ...accepted.map((item, index) => ({
            id: `incoming-${index}`,
            stem: item.payload.stem,
            key: `${normalizeQuestionText(item.payload.stem)}|${item.payload.options.map(normalizeQuestionText).join('|')}`,
          })),
        ].find((candidate) => candidate.key === key);
        if (exact) {
          duplicateSkips.push({
            fileName: report.sourceFile,
            page: payload.sourcePage,
            reason: `Exact duplicate of ${exact.id}.`,
          });
          await recordConfirmedDuplicateAttempt(
            user,
            'question',
            await sha256Text(key),
            exact.id,
          );
          continue;
        }
        const nearest = candidates
          .map((candidate) => ({ ...candidate, similarity: tokenSimilarity(payload.stem, candidate.stem) }))
          .sort((left, right) => right.similarity - left.similarity)[0];
        accepted.push({
          payload,
          duplicateInfo:
            nearest && nearest.similarity >= ABUSE_LIMITS.nearDuplicateSimilarity
              ? {
                  type: 'possible',
                  similarity: Math.round(nearest.similarity * 100),
                  matchedQuestionId: nearest.id,
                }
              : undefined,
        });
      }
      if (!accepted.length)
        return json(
          { error: 'All valid questions were exact duplicates.', skipped: [...report.skipped, ...duplicateSkips] },
          409,
        );
      const pending = await env.DB.prepare(
        "SELECT count(*) AS value FROM records WHERE type='questionProposals' AND owner_id=? AND json_extract(payload,'$.status')='pending'",
      ).bind(user.uid).first<{ value: number }>();
      if ((pending?.value ?? 0) + accepted.length > limits.maxPendingReviewQuestions)
        return json(
          { error: 'Your submission queue is full. Please wait until some questions are reviewed before importing more.' },
          403,
        );
      const proposals = accepted.map(({ payload, duplicateInfo }, index) => ({
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
        duplicateInfo,
        status: 'pending',
        proposedById: user.uid,
        proposedByName: user.displayName,
        proposedAt: now,
      }));
      const result = {
        proposals,
        total: proposals.length + report.skipped.length + duplicateSkips.length,
        successful: proposals.length,
        failed: report.skipped.length + duplicateSkips.length,
        skippedDuplicates: duplicateSkips.length,
        pendingReview: proposals.length,
        skipped: [...report.skipped, ...duplicateSkips],
        repaired: report.repaired || input.repaired === true,
      };
      try {
        await env.DB.batch([
          env.DB.prepare('INSERT INTO import_batches VALUES(?,?,?)').bind(batchId, user.uid, JSON.stringify(result)),
          env.DB.prepare(
            'INSERT INTO imported_files(id,user_id,file_name,normalized_name,file_hash,batch_id,source_file,successful_count,skipped_count,report_json,uploaded_at,daily_limit,pending_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ).bind(crypto.randomUUID(), user.uid, uploadedFileName, normalizedName, fileHash, batchId, report.sourceFile, proposals.length, report.skipped.length + duplicateSkips.length, JSON.stringify([...report.skipped, ...duplicateSkips]), now, limits.jsonImportDailyLimit, limits.maxPendingReviewQuestions),
          env.DB.prepare(
            "INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) SELECT 'questionProposals',json_extract(value,'$.id'),?,?,value,? FROM json_each(?)",
          ).bind(bank.id, user.uid, now, JSON.stringify(proposals)),
          auditStatement(user, 'questions_json_imported', bank.id, null, {
            batchId, fileName: uploadedFileName, fileHash, count: proposals.length, skipped: report.skipped.length,
          }),
        ]);
      } catch (error) {
        if (String(error).includes('JSON_IMPORT_DAILY_LIMIT'))
          return json({ error: `You've reached your daily JSON import limit (${limits.jsonImportDailyLimit}).` }, 403);
        if (String(error).includes('JSON_IMPORT_PENDING_LIMIT'))
          return json({ error: 'Your submission queue is full. Please wait until some questions are reviewed before importing more.' }, 403);
        if (String(error).includes('UNIQUE constraint failed'))
          return json({ error: 'هذا الملف تم رفعه مسبقًا. لا تحتاج إلى رفعه مرة أخرى.' }, 409);
        throw error;
      }
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

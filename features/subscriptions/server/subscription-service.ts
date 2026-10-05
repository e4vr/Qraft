import { env } from 'cloudflare:workers';
import { ValidationError } from '@/server/http/errors';
import type { AppUser } from '@/lib/medguard-types';
import { applyEffectiveEntitlement } from '@/lib/entitlement-server';
import { json } from '@/server/http/response';
import {
  codeStatus,
  durationEnd,
  grantStatus,
  validateDuration,
  type AccessGrant,
  type ActivationCode,
  type ActivationCodeListing,
  type DurationUnit,
} from '../domain/access-model';
import { type PlanId } from '../domain/plan-config';
import {
  accessSourcesCte,
  accessSourceTimes,
  rewardStatusSql,
  rewardWalletFields,
} from './access-sources';
import { quote } from './discount-quote';

type Actor = Pick<AppUser, 'uid' | 'displayName'>;
export class AccessError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const text = (input: Record<string, unknown>, key: string) =>
  typeof input[key] === 'string' ? (input[key] as string).trim() : '';
const nowIso = () => new Date().toISOString();
const codeFields =
  'id,hint,name,duration,duration_unit,plan,bound_user_id,redeem_before,created_at,created_by,disabled_at,redeemed_at,redeemed_by,grant_id';
export const normalizeCode = (value: string) =>
  value.toUpperCase().replace(/[\s-]/g, '');
async function codeHash(code: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalizeCode(code)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
function operationId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(value))
    throw new AccessError('Invalid operation ID.');
  return value;
}
async function target(uid: string) {
  const row = await env.DB.prepare(
    'SELECT profile_json FROM profiles WHERE uid=?',
  )
    .bind(uid)
    .first<{ profile_json: string }>();
  if (!row) throw new AccessError('Account not found.', 404);
  const user = JSON.parse(row.profile_json) as AppUser;
  if (user.role === 'super_admin')
    throw new AccessError(
      'Superadmin access is permanent and cannot be changed.',
    );
  return user;
}
async function receipt(id: string, actor: Actor, uid: string, action: string) {
  const row = await env.DB.prepare('SELECT * FROM access_operations WHERE id=?')
    .bind(id)
    .first<{
      actor_id: string;
      user_id: string;
      action: string;
      result_json: string;
    }>();
  if (!row) return null;
  if (
    row.actor_id !== actor.uid ||
    row.user_id !== uid ||
    row.action !== action
  )
    throw new AccessError('This operation ID belongs to another action.', 409);
  return { ...JSON.parse(row.result_json), duplicate: true } as Record<
    string,
    unknown
  >;
}
const log = (
  id: string,
  actor: Actor,
  uid: string,
  action: string,
  now: string,
  result: unknown,
) =>
  env.DB.prepare(
    'INSERT INTO access_operations(id,user_id,actor_id,action,created_at,result_json) VALUES(?,?,?,?,?,?)',
  ).bind(id, uid, actor.uid, action, now, JSON.stringify(result));
const audit = (
  id: string,
  actor: Actor,
  uid: string,
  action: string,
  now: string,
  detail: unknown,
) =>
  env.DB.prepare(
    "INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('auditLog',?,?,?,?)",
  ).bind(
    'access-' + id,
    actor.uid,
    JSON.stringify({
      id: 'access-' + id,
      entityType: 'account',
      entityId: uid,
      actorId: actor.uid,
      actorName: actor.displayName,
      action,
      createdAt: now,
      detail: JSON.stringify(detail),
    }),
    now,
  );

async function accountVersion(uid: string, now: string) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO access_accounts(user_id,version,updated_at) VALUES(?,0,?)',
  )
    .bind(uid, now)
    .run();
  return (await env.DB.prepare(
    'SELECT version FROM access_accounts WHERE user_id=?',
  )
    .bind(uid)
    .first<{ version: number }>())!.version;
}
function guardedBatch(
  uid: string,
  version: number,
  id: string,
  now: string,
  statements: D1PreparedStatement[],
) {
  return env.DB.batch([
    env.DB.prepare(
      'INSERT INTO access_operation_guards(id,valid) SELECT ?,version=? FROM access_accounts WHERE user_id=?',
    ).bind(id, version, uid),
    ...statements,
    env.DB.prepare(
      'UPDATE access_accounts SET version=version+1,updated_at=? WHERE user_id=?',
    ).bind(now, uid),
    env.DB.prepare('DELETE FROM access_operation_guards WHERE id=?').bind(id),
  ]);
}
async function retry<T>(work: () => Promise<T>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AccessError) throw error;
      if (
        !String(error).includes('CHECK constraint failed') &&
        !String(error).includes('UNIQUE constraint failed')
      )
        throw error;
      if (attempt === 4)
        throw new AccessError(
          'Access changed in another request. Retry the same operation.',
          409,
        );
    }
  }
  throw new AccessError('Please retry.', 409);
}

export async function grantAccess(
  actor: Actor,
  input: {
    userId: string;
    requestId: string;
    duration: number;
    unit: DurationUnit;
    source: string;
    sourceId: string;
    label: string;
    plan?: PlanId;
    paid?: number;
    reference?: string;
    extra?: (grant: AccessGrant, now: string) => D1PreparedStatement[];
  },
) {
  const id = operationId(input.requestId),
    uid = input.userId;
  validateDuration(input.duration, input.unit);
  const paid = input.paid ?? 0;
  if (!Number.isSafeInteger(paid) || paid < 0 || paid > 100000000)
    throw new AccessError('Invalid payment amount.');
  await target(uid);
  return retry(async () => {
    const previous = await receipt(id, actor, uid, 'grant');
    if (previous) return previous;
    const now = nowIso(),
      version = await accountVersion(uid, now);
    const end = await env.DB.prepare(
      'SELECT max(expires_at) AS value FROM access_grants WHERE user_id=? AND revoked_at IS NULL AND expires_at>?',
    )
      .bind(uid, now)
      .first<{ value: string | null }>();
    const startsAt = end?.value ?? now;
    const grant: AccessGrant = {
      id: 'grant-' + id,
      user_id: uid,
      source: input.source,
      source_id: input.sourceId,
      label: input.label,
      plan:
        input.plan ??
        (input.unit === 'month' && input.duration === 3
          ? 'full_quarterly'
          : 'full_monthly'),
      duration: input.duration,
      duration_unit: input.unit,
      starts_at: startsAt,
      expires_at: durationEnd(startsAt, input.duration, input.unit),
      created_at: now,
      created_by: actor.uid,
      revoked_at: null,
      revoked_by: null,
      revoke_reason: null,
    };
    const result = { grant, startsAt, expiresAt: grant.expires_at };
    await guardedBatch(uid, version, id, now, [
      ...(input.extra?.(grant, now) ?? []),
      env.DB.prepare(
        'INSERT INTO access_grants(id,user_id,source,source_id,label,plan,duration,duration_unit,starts_at,expires_at,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        grant.id,
        uid,
        grant.source,
        grant.source_id,
        grant.label,
        grant.plan,
        grant.duration,
        grant.duration_unit,
        grant.starts_at,
        grant.expires_at,
        now,
        actor.uid,
      ),
      ...(paid > 0
        ? [
            env.DB.prepare(
              'INSERT INTO access_payments(id,user_id,grant_id,amount,reference,confirmed_by,confirmed_at) VALUES(?,?,?,?,?,?,?)',
            ).bind(
              'payment-' + id,
              uid,
              grant.id,
              paid,
              input.reference ?? '',
              actor.uid,
              now,
            ),
          ]
        : []),
      log(id, actor, uid, 'grant', now, result),
      audit(id, actor, uid, 'access_granted', now, { ...result, paid }),
    ]);
    return result as Record<string, unknown>;
  });
}

export async function cancelAccess(
  actor: Actor,
  input: {
    userId: string;
    requestId: string;
    grantId?: string;
    reason: string;
  },
) {
  const uid = input.userId,
    id = operationId(input.requestId);
  if (!input.reason.trim() || input.reason.length > 500)
    throw new AccessError(
      'A cancellation reason of up to 500 characters is required.',
    );
  await target(uid);
  return retry(async () => {
    const prior = await receipt(id, actor, uid, 'cancel');
    if (prior) return prior;
    const now = nowIso(),
      version = await accountVersion(uid, now);
    const rows = await env.DB.prepare(
      'SELECT * FROM access_grants WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY starts_at,created_at,id',
    )
      .bind(uid, now)
      .all<AccessGrant>();
    if (
      input.grantId &&
      !rows.results.some((grant) => grant.id === input.grantId)
    )
      throw new AccessError('No cancellable grant found.', 409);
    const updates: D1PreparedStatement[] = [],
      changed: AccessGrant[] = [];
    let cursor = now;
    for (const grant of rows.results) {
      if (!input.grantId || grant.id === input.grantId) {
        updates.push(
          env.DB.prepare(
            'UPDATE access_grants SET revoked_at=?,revoked_by=?,revoke_reason=? WHERE id=?',
          ).bind(now, actor.uid, input.reason, grant.id),
        );
        changed.push({
          ...grant,
          revoked_at: now,
          revoked_by: actor.uid,
          revoke_reason: input.reason,
        });
      } else if (grant.starts_at > now) {
        const expiresAt = durationEnd(
          cursor,
          grant.duration,
          grant.duration_unit,
        );
        updates.push(
          env.DB.prepare(
            'UPDATE access_grants SET starts_at=?,expires_at=? WHERE id=?',
          ).bind(cursor, expiresAt, grant.id),
        );
        changed.push({ ...grant, starts_at: cursor, expires_at: expiresAt });
        cursor = expiresAt;
      } else {
        cursor = grant.expires_at;
      }
    }
    const result = { cancelled: input.grantId ?? 'all', changed };
    await guardedBatch(uid, version, id, now, [
      ...updates,
      log(id, actor, uid, 'cancel', now, result),
      audit(id, actor, uid, 'access_cancelled', now, {
        previous: rows.results,
        ...result,
        reason: input.reason,
      }),
    ]);
    return result as Record<string, unknown>;
  });
}

async function createCodes(actor: Actor, input: Record<string, unknown>) {
  const id = operationId(input.requestId),
    name = text(input, 'name');
  if (!name || name.length > 160)
    throw new AccessError('Enter a code name (up to 160 characters).');
  const { duration, unit } = validateDuration(input.duration, input.unit);
  const bound = text(input, 'userId');
  if (input.userId != null && typeof input.userId !== 'string')
    throw new AccessError('Choose a valid account for this code.');
  if (
    input.audience !== undefined &&
    input.audience !== 'any' &&
    input.audience !== 'member'
  )
    throw new AccessError('Choose who can use this code.');
  if (input.audience === 'member' && !bound)
    throw new AccessError('Select the account allowed to use this code.');
  if (input.audience === 'any' && bound)
    throw new AccessError(
      'An unrestricted code cannot have a selected account.',
    );
  if (bound) await target(bound);
  const beforeInput = text(input, 'redeemBefore'),
    before = beforeInput ? new Date(beforeInput).toISOString() : null;
  if (before && Date.parse(before) <= Date.now())
    throw new AccessError('Choose a future redemption deadline.');
  const secrets = input.codes;
  if (
    !Array.isArray(secrets) ||
    secrets.length < 1 ||
    secrets.length > 25 ||
    secrets.some(
      (secret) =>
        typeof secret !== 'string' ||
        !/^[A-F0-9]{40}$/.test(normalizeCode(secret)),
    ) ||
    new Set(secrets.map((value) => normalizeCode(String(value)))).size !==
      secrets.length
  )
    throw new AccessError('Generate 1–25 unique activation codes.');
  const prior = await receipt(id, actor, actor.uid, 'create_codes');
  if (prior) return prior;
  const now = nowIso(),
    codes: ActivationCode[] = [],
    statements: D1PreparedStatement[] = [];
  for (let index = 0; index < secrets.length; index++) {
    const secret = normalizeCode(String(secrets[index])),
      codeId = 'code-' + id + '-' + index;
    const code: ActivationCode = {
      id: codeId,
      hint: secret.slice(-6),
      name: secrets.length === 1 ? name : `${name} · ${index + 1}`,
      duration,
      duration_unit: unit,
      plan:
        unit === 'month' && duration === 3 ? 'full_quarterly' : 'full_monthly',
      bound_user_id: bound || null,
      redeem_before: before,
      created_at: now,
      created_by: actor.uid,
      disabled_at: null,
      redeemed_at: null,
      redeemed_by: null,
      grant_id: null,
    };
    codes.push(code);
    statements.push(
      env.DB.prepare(
        'INSERT INTO activation_codes(id,code_hash,hint,name,duration,duration_unit,plan,bound_user_id,redeem_before,created_at,created_by,operation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        codeId,
        await codeHash(secret),
        code.hint,
        code.name,
        duration,
        unit,
        code.plan,
        bound || null,
        before,
        now,
        actor.uid,
        id + '-' + index,
      ),
    );
  }
  const result = { codes };
  try {
    await env.DB.batch([
      ...statements,
      log(id, actor, actor.uid, 'create_codes', now, result),
      audit(id, actor, actor.uid, 'activation_codes_created', now, {
        count: codes.length,
        name,
        duration,
        unit,
        bound,
      }),
    ]);
  } catch (error) {
    const recovered = await receipt(id, actor, actor.uid, 'create_codes');
    if (recovered) return recovered;
    throw error;
  }
  return result;
}

async function redeemCode(user: AppUser, input: Record<string, unknown>) {
  const id = operationId(input.requestId),
    secret = normalizeCode(text(input, 'code'));
  const previous = await receipt(id, user, user.uid, 'grant');
  if (previous)
    return { ...previous, user: await applyEffectiveEntitlement(user) };
  if (!/^[A-F0-9]{40}$/.test(secret))
    throw new AccessError(
      'This activation code is invalid or unavailable.',
      409,
    );
  const code = await env.DB.prepare(
    'SELECT * FROM activation_codes WHERE code_hash=?',
  )
    .bind(await codeHash(secret))
    .first<ActivationCode>();
  if (
    !code ||
    codeStatus(code) !== 'unused' ||
    (code.bound_user_id && code.bound_user_id !== user.uid)
  )
    throw new AccessError(
      'This activation code is invalid or unavailable.',
      409,
    );
  const result = await grantAccess(user, {
    userId: user.uid,
    requestId: id,
    source: 'activation_code',
    sourceId: code.id,
    label: code.name,
    duration: code.duration,
    unit: code.duration_unit,
    plan: code.plan,
    extra: (grant, now) => [
      env.DB.prepare(
        'INSERT INTO access_operation_guards(id,valid) SELECT ?,CASE WHEN disabled_at IS NULL AND redeemed_at IS NULL AND (redeem_before IS NULL OR redeem_before>?) AND (bound_user_id IS NULL OR bound_user_id=?) THEN 1 ELSE 0 END FROM activation_codes WHERE id=?',
      ).bind('code-' + id, now, user.uid, code.id),
      env.DB.prepare(
        'UPDATE activation_codes SET redeemed_at=?,redeemed_by=?,grant_id=? WHERE id=?',
      ).bind(now, user.uid, grant.id, code.id),
      env.DB.prepare('DELETE FROM access_operation_guards WHERE id=?').bind(
        'code-' + id,
      ),
    ],
  });
  return { ...result, user: await applyEffectiveEntitlement(user) };
}

export async function subscriptionApi(
  request: Request,
  action: string,
  user: AppUser,
  input: Record<string, unknown>,
) {
  const root =
    user.role === 'super_admin' && user.mfaEnrolled && user.mfaVerified;
  const url = new URL(request.url);
  try {
    if (action === 'activation-code') {
      if (request.method !== 'POST')
        return json({ error: 'Method not allowed.' }, 405);
      return json(await redeemCode(user, input));
    }
    if (action === 'access-account') {
      if (request.method !== 'GET')
        return json({ error: 'Method not allowed.' }, 405);
      const uid = root ? url.searchParams.get('userId') || user.uid : user.uid;
      if (uid !== user.uid) await target(uid);
      const [grants, operations, payments, gifts] = await env.DB.batch([
        env.DB.prepare(
          'SELECT * FROM access_grants WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100',
        ).bind(uid),
        env.DB.prepare(
          'SELECT id,action,actor_id,created_at,result_json FROM access_operations WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
        ).bind(uid),
        env.DB.prepare(
          'SELECT * FROM access_payments WHERE user_id=? ORDER BY confirmed_at DESC LIMIT 100',
        ).bind(uid),
        env.DB.prepare(
          "SELECT id,plan,duration,duration_unit,duration_days,status,created_at FROM reward_passes WHERE user_id=? AND status='available' ORDER BY created_at DESC LIMIT 100",
        ).bind(uid),
      ]);
      return json({
        grants: (grants.results as AccessGrant[]).map((grant) => ({
          ...grant,
          status: grantStatus(grant),
        })),
        operations: root ? operations.results : [],
        payments: root ? payments.results : [],
        gifts: gifts.results,
      });
    }
    if (!root) return json({ error: 'Superadmin MFA required.' }, 403);
    if (action === 'access-admin' && request.method === 'GET') {
      const view = url.searchParams.get('view');
      const search = (url.searchParams.get('search') || '').slice(0, 100);
      const offset = Math.max(
        0,
        Math.floor(Number(url.searchParams.get('offset')) || 0),
      );
      if (view === 'activity') {
        const rows =
          await env.DB.prepare(`SELECT o.id,o.user_id,o.actor_id,o.action,o.created_at,
          json_extract(p.profile_json,'$.displayName') AS name,p.email FROM access_operations o LEFT JOIN profiles p ON p.uid=o.user_id
          WHERE instr(lower(coalesce(p.email,'')),lower(?))>0 OR instr(lower(coalesce(p.profile_json,'')),lower(?))>0
          ORDER BY o.created_at DESC,o.id DESC LIMIT 51 OFFSET ?`)
            .bind(search, search, offset)
            .all();
        return json({ operations: rows.results });
      }
      if (view === 'gifts') {
        const rows =
          await env.DB.prepare(`SELECT ${rewardWalletFields()},p.email,json_extract(p.profile_json,'$.displayName') AS name,r.user_id
          FROM reward_passes r JOIN profiles p ON p.uid=r.user_id
          WHERE (instr(lower(p.email),lower(?))>0 OR instr(lower(p.profile_json),lower(?))>0)
          AND (?='all' OR ${rewardStatusSql()}=?) ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET ?`)
            .bind(
              search,
              search,
              url.searchParams.get('status') || 'all',
              url.searchParams.get('status') || 'all',
              offset,
            )
            .all();
        return json({ gifts: rows.results });
      }
      const now = nowIso(),
        filter = url.searchParams.get('status') || 'all';
      const cte = `${accessSourcesCte()}, selected AS (SELECT *,json_extract(profile_json,'$.role') AS role,json_extract(profile_json,'$.status') AS account_status FROM resolved
        WHERE (instr(lower(email),lower(?))>0 OR instr(lower(name),lower(?))>0 OR instr(lower(uid),lower(?))>0)
        AND (?='all' OR (?='full' AND tier<>'free') OR (?='free' AND tier='free') OR (?='pending' AND json_extract(profile_json,'$.status')<>'approved')))`;
      const args = [
        ...accessSourceTimes(now),
        search,
        search,
        search,
        filter,
        filter,
        filter,
        filter,
      ];
      const [rows, summary, prices] = await env.DB.batch([
        env.DB.prepare(
          `${cte} SELECT uid,email,name,tier,role,account_status,effective_expires_at FROM selected ORDER BY CASE WHEN tier<>'free' THEN 0 ELSE 1 END,effective_expires_at,email LIMIT 51 OFFSET ?`,
        ).bind(...args, offset),
        env.DB.prepare(`${accessSourcesCte()} SELECT count(*) AS accounts,sum(tier<>'free' AND coalesce(json_extract(profile_json,'$.role'),'student')<>'super_admin') AS full,sum(tier='free') AS free,
          sum(effective_expires_at>? AND effective_expires_at<=?) AS endingSoon,
          (SELECT count(*) FROM activation_codes WHERE redeemed_at IS NULL AND disabled_at IS NULL AND (redeem_before IS NULL OR redeem_before>?)) AS unusedCodes,
          (SELECT coalesce(sum(amount),0) FROM access_payments) AS confirmedPayments FROM resolved`).bind(
          ...accessSourceTimes(now),
          now,
          new Date(Date.now() + 7 * 86400000).toISOString(),
          now,
        ),
        env.DB.prepare(
          "SELECT plan,coalesce(price_halalas,price_sar_period*100) AS price FROM plan_prices WHERE plan<>'free'",
        ),
      ]);
      return json({
        members: rows.results,
        summary: summary.results[0],
        prices: prices.results,
      });
    }
    if (action === 'activation-codes') {
      if (request.method === 'POST' && text(input, 'operation') === 'create')
        return json(await createCodes(user, input), 201);
      if (request.method === 'POST' && text(input, 'operation') === 'disable') {
        const id = operationId(input.requestId),
          codeId = text(input, 'codeId');
        return json(
          await retry(async () => {
            const previous = await receipt(id, user, user.uid, 'disable_code');
            if (previous) return previous;
            const now = nowIso();
            const code = await env.DB.prepare(
              'SELECT redeemed_at FROM activation_codes WHERE id=?',
            )
              .bind(codeId)
              .first<{ redeemed_at: string | null }>();
            if (!code || code.redeemed_at)
              throw new AccessError(
                'Only an unused code can be disabled.',
                409,
              );
            await env.DB.batch([
              env.DB.prepare(
                'INSERT INTO access_operation_guards(id,valid) SELECT ?,redeemed_at IS NULL FROM activation_codes WHERE id=?',
              ).bind(id, codeId),
              env.DB.prepare(
                'UPDATE activation_codes SET disabled_at=coalesce(disabled_at,?) WHERE id=?',
              ).bind(now, codeId),
              log(id, user, user.uid, 'disable_code', now, { codeId }),
              audit(id, user, user.uid, 'activation_code_disabled', now, {
                codeId,
              }),
              env.DB.prepare(
                'DELETE FROM access_operation_guards WHERE id=?',
              ).bind(id),
            ]);
            return { ok: true };
          }),
        );
      }
      if (request.method !== 'GET')
        return json({ error: 'Method not allowed.' }, 405);
      const query = (url.searchParams.get('search') || '').slice(0, 100),
        offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const filter = url.searchParams.get('status') || 'all',
        now = nowIso();
      const rows =
        await env.DB.prepare(`WITH selected AS (SELECT ${codeFields},CASE WHEN redeemed_at IS NOT NULL THEN 'used' WHEN disabled_at IS NOT NULL THEN 'disabled' WHEN redeem_before IS NOT NULL AND redeem_before<=? THEN 'expired' ELSE 'unused' END AS status FROM activation_codes)
        SELECT c.*,json_extract(p.profile_json,'$.displayName') AS bound_user_name,p.email AS bound_user_email
        FROM selected c LEFT JOIN profiles p ON p.uid=c.bound_user_id
        WHERE (instr(lower(c.name),lower(?))>0 OR instr(c.hint,upper(?))>0 OR instr(lower(coalesce(p.email,'')),lower(?))>0 OR instr(lower(coalesce(json_extract(p.profile_json,'$.displayName'),'')),lower(?))>0 OR instr(lower(coalesce(c.bound_user_id,'')),lower(?))>0)
        AND (?='all' OR c.status=?) ORDER BY c.created_at DESC,c.id DESC LIMIT 51 OFFSET ?`)
          .bind(now, query, query, query, query, query, filter, filter, offset)
          .all<ActivationCodeListing>();
      return json({
        codes: rows.results.map((code) => ({
          ...code,
          status: codeStatus(code),
        })),
      });
    }
    if (action === 'access-admin' && request.method === 'POST') {
      const uid = text(input, 'userId'),
        operation = text(input, 'operation'),
        id = operationId(input.requestId);
      if (operation === 'quote') {
        const member = await target(uid),
          { duration, unit } = validateDuration(input.duration, input.unit);
        if (unit !== 'month' || ![1, 3].includes(duration))
          throw new AccessError('Discounts require 1 or 3 calendar months.');
        return json(
          await quote(
            member,
            text(input, 'discountCode'),
            duration === 3 ? 'full_quarterly' : 'full_monthly',
          ),
        );
      }
      if (operation === 'grant') {
        const { duration, unit } = validateDuration(input.duration, input.unit);
        const label = text(input, 'label');
        if (!label || label.length > 160)
          throw new AccessError('Enter a grant label.');
        const prior = await receipt(id, user, uid, 'grant');
        if (prior) return json(prior);
        const code = text(input, 'discountCode'),
          member = await target(uid);
        if (code && (unit !== 'month' || ![1, 3].includes(duration)))
          throw new AccessError(
            'Discounts require the catalog duration of 1 or 3 months.',
          );
        const price = code
          ? await quote(
              member,
              code,
              duration === 3 ? 'full_quarterly' : 'full_monthly',
            )
          : null;
        const paid = Number(input.paid ?? 0);
        if (price && paid !== price.final)
          throw new AccessError(
            `This discount requires a confirmed amount of ${price.final / 100} SAR.`,
          );
        return json(
          await grantAccess(user, {
            userId: uid,
            requestId: id,
            duration,
            unit,
            source: 'manual',
            sourceId: id,
            label,
            paid,
            reference: text(input, 'reference').slice(0, 240),
            extra: price
              ? (grant, now) => [
                  env.DB.prepare(
                    "INSERT INTO subscription_events(id,user_id,email,name,code_id,code,action,original,discount,final,status,created_at,starts_at,expires_at,detail,admin_id,plan) VALUES(?,?,?,?,?,?,'discount_redeemed',?,?,?,'success',?,?,?,'Manual activation',?,?)",
                  ).bind(
                    id,
                    uid,
                    member.email,
                    member.displayName,
                    price.codeId,
                    price.code,
                    price.original,
                    price.discount,
                    price.final,
                    now,
                    grant.starts_at,
                    grant.expires_at,
                    user.uid,
                    price.plan,
                  ),
                ]
              : undefined,
          }),
        );
      }
      if (operation === 'cancel' || operation === 'revoke')
        return json(
          await cancelAccess(user, {
            userId: uid,
            requestId: id,
            grantId:
              operation === 'cancel' ? text(input, 'grantId') : undefined,
            reason: text(input, 'reason'),
          }),
        );
      if (operation === 'gift') {
        const { duration, unit } = validateDuration(input.duration, input.unit);
        await target(uid);
        return json(
          await retry(async () => {
            const previous = await receipt(id, user, uid, 'gift');
            if (previous) return previous;
            const now = nowIso(),
              passId = 'gift-' + id;
            await env.DB.batch([
              env.DB.prepare(
                "INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,duration_days,status,created_at,source,metadata) VALUES(?,?,?,?,?,?,'available',?,'admin',?)",
              ).bind(
                passId,
                uid,
                unit === 'month' && duration === 3
                  ? 'full_quarterly'
                  : 'full_monthly',
                unit === 'day' ? 1 : duration,
                unit === 'day' ? 'month' : unit,
                unit === 'day' ? duration : null,
                now,
                JSON.stringify({ reason: text(input, 'label').slice(0, 160) }),
              ),
              log(id, user, uid, 'gift', now, { passId }),
              audit(id, user, uid, 'gift_issued', now, {
                passId,
                duration,
                unit,
              }),
            ]);
            return { passId };
          }),
        );
      }
      throw new AccessError('Unknown subscription action.');
    }
    return json({ error: 'Method not allowed.' }, 405);
  } catch (error) {
    if (error instanceof ValidationError)
      return json({ error: error.message }, 400);
    if (String(error).includes('DISCOUNT_UNAVAILABLE'))
      return json(
        { error: 'This discount is no longer available. Refresh the quote.' },
        409,
      );
    if (error instanceof AccessError)
      return json({ error: error.message }, error.status);
    if (
      error instanceof RangeError ||
      (error instanceof Error &&
        /Choose .*days|Invalid start/.test(error.message))
    )
      return json({ error: error.message }, 400);
    throw error;
  }
}

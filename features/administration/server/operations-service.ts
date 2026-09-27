import { env } from 'cloudflare:workers';
import type { AppUser, MemberProfile } from '@/lib/medguard-types';
import { currentUser, profileById } from '@/features/auth/server/auth-service';
import { assertSameOrigin, readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { auditStatement } from '@/lib/platform-server';
import {
  PLAN_ORDER,
  PLAN_LIMITS,
  isPlanId,
} from '@/features/subscriptions/domain/plan-config';
import { publishChanges } from '@/lib/realtime-server';
import { validatePlanPolicy } from '../domain/plan-policy';
export { accountBlocked } from '../domain/account-block';

export type SiteOperations = {
  maintenance: number;
  message: string;
  ends_at: string | null;
  revision: number;
  updated_at: string;
};
export async function siteOperations() {
  return (await env.DB.prepare(
    'SELECT maintenance,message,ends_at,revision,updated_at FROM site_operations WHERE id=1',
  ).first<SiteOperations>())!;
}
export function maintenanceActive(settings: SiteOperations, now = Date.now()) {
  return (
    settings.maintenance === 1 &&
    (!settings.ends_at || Date.parse(settings.ends_at) > now)
  );
}
export async function planCatalog() {
  const rows = await env.DB.prepare(
    'SELECT plan,coalesce(price_halalas,price_sar_year*100) AS price,policy_json,updated_at FROM plan_prices',
  ).all<{
    plan: string;
    price: number;
    policy_json: string | null;
    updated_at: string;
  }>();
  return {
    plans: PLAN_ORDER.map((id) => {
      const row = rows.results.find((row) => row.plan === id);
      return {
        id,
        ...PLAN_LIMITS[id],
        description: '',
        ...(row?.policy_json ? JSON.parse(row.policy_json) : {}),
        price: row?.price ?? PLAN_LIMITS[id].priceSarYear * 100,
      };
    }),
  };
}
async function requireRoot(request: Request): Promise<AppUser> {
  const user = await currentUser(request);
  if (
    !user ||
    user.status !== 'approved' ||
    user.role !== 'super_admin' ||
    !user.mfaEnrolled ||
    !user.mfaVerified
  )
    throw json({ error: 'Superadmin MFA required.' }, 403);
  return user;
}
export async function operationsApi(request: Request, action: string) {
  if (action === 'plan-catalog' && request.method === 'GET') {
    if (!(await currentUser(request)))
      return json({ error: 'Authentication required.' }, 401);
    return json(await planCatalog());
  }
  const user = await requireRoot(request);
  if (request.method === 'GET')
    return json(
      action === 'site-operations'
        ? await siteOperations()
        : await planCatalog(),
    );
  if (request.method !== 'PUT' && request.method !== 'POST')
    return json({ error: 'Method not allowed.' }, 405);
  assertSameOrigin(request);
  const input = await readJson<Record<string, unknown>>(request, 16_000);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500)
    return json({ error: 'Enter an audit reason (3–500 characters).' }, 400);
  if (action === 'site-operations') {
    const previous = await siteOperations();
    if (
      typeof input.maintenance !== 'boolean' ||
      typeof input.message !== 'string' ||
      !input.message.trim() ||
      input.message.length > 500 ||
      !Number.isInteger(input.revision)
    )
      return json({ error: 'Invalid site settings.' }, 400);
    if (
      input.endsAt !== null &&
      input.endsAt !== undefined &&
      typeof input.endsAt !== 'string'
    )
      return json({ error: 'Invalid maintenance end.' }, 400);
    const endsAt =
      typeof input.endsAt === 'string' && input.endsAt ? input.endsAt : null;
    if (
      endsAt &&
      (!Number.isFinite(Date.parse(endsAt)) ||
        Date.parse(endsAt) <= Date.now() ||
        Date.parse(endsAt) > Date.now() + 7 * 86_400_000)
    )
      return json(
        { error: 'Maintenance end must be within the next 7 days.' },
        400,
      );
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const event = {
      id: auditId,
      action: 'site_operations_changed',
      entityType: 'system',
      entityId: 'site',
      actorId: user.uid,
      actorName: user.displayName,
      createdAt: now,
      detail: JSON.stringify({
        previous,
        next: {
          maintenance: input.maintenance,
          message: input.message,
          endsAt,
          reason,
        },
      }),
    };
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO records(type,id,owner_id,payload,updated_at) SELECT 'auditLog',?,?,?,? WHERE EXISTS(SELECT 1 FROM site_operations WHERE id=1 AND revision=?)",
      ).bind(auditId, user.uid, JSON.stringify(event), now, input.revision),
      env.DB.prepare(
        'UPDATE site_operations SET maintenance=?,message=?,ends_at=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=1 AND revision=?',
      ).bind(
        input.maintenance ? 1 : 0,
        input.message.trim(),
        endsAt ? new Date(endsAt).toISOString() : null,
        now,
        user.uid,
        input.revision,
      ),
    ]);
    if (!results[1].meta.changes)
      return json(
        { error: 'Site settings changed. Refresh before saving.' },
        409,
      );
    await publishChanges(['admin', 'catalog'], ['site-operations']);
    return json(await siteOperations());
  }
  if (action === 'plan-pricing') {
    if (!Array.isArray(input.plans) || ![3, 4].includes(input.plans.length))
      return json(
        {
          error:
            'Submit all paid plan prices, optionally including Free details.',
        },
        400,
      );
    const plans = input.plans as Array<{
      id?: unknown;
      price?: unknown;
      policy?: unknown;
    }>;
    if (
      new Set(plans.map((plan) => plan.id)).size !== plans.length ||
      plans.some(
        (plan) =>
          !isPlanId(plan.id) ||
          typeof plan.price !== 'number' ||
          !Number.isSafeInteger(plan.price) ||
          plan.price < (plan.id === 'free' ? 0 : 1) ||
          (plan.id === 'free' && plan.price !== 0) ||
          plan.price > 10_000_000,
      ) ||
      !['lite', 'pro', 'unlimited'].every((id) =>
        plans.some((plan) => plan.id === id),
      )
    )
      return json(
        { error: 'Paid prices must be 0.01–100,000 SAR; Free stays at zero.' },
        400,
      );
    const previous = await planCatalog();
    const policies = new Map<string, string>();
    try {
      for (const plan of plans)
        if (plan.policy !== undefined) {
          const current = previous.plans.find((row) => row.id === plan.id)!;
          policies.set(
            String(plan.id),
            JSON.stringify({
              ...current,
              ...validatePlanPolicy(plan.policy, current),
            }),
          );
        }
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error ? error.message : 'Invalid plan policy.',
        },
        400,
      );
    }
    const now = new Date().toISOString();
    await env.DB.batch([
      ...plans.map((plan) =>
        env.DB.prepare(
          'UPDATE plan_prices SET price_halalas=?,price_sar_year=?,policy_json=coalesce(?,policy_json),updated_at=? WHERE plan=?',
        ).bind(
          plan.price,
          Number(plan.price) / 100,
          policies.get(String(plan.id)) ?? null,
          now,
          plan.id,
        ),
      ),
      auditStatement(
        user,
        'plan_prices_changed',
        'pricing',
        previous.plans.map((plan) => ({ id: plan.id, price: plan.price })),
        { plans, reason },
      ),
    ]);
    await publishChanges(['admin', 'catalog'], ['pricing', 'account']);
    return json(await planCatalog());
  }
  if (action === 'account-block') {
    if (
      typeof input.userId !== 'string' ||
      typeof input.blocked !== 'boolean' ||
      !Number.isInteger(input.days) ||
      Number(input.days) < 1 ||
      Number(input.days) > 365
    )
      return json({ error: 'Choose an account and 1–365 block days.' }, 400);
    const row = await profileById(input.userId);
    const profile = row
      ? (JSON.parse(row.profile_json) as MemberProfile)
      : null;
    if (!profile || profile.role === 'super_admin')
      return json({ error: 'This account cannot be blocked.' }, 403);
    const next = {
      ...profile,
      suspended: input.blocked,
      suspendedUntil: input.blocked
        ? new Date(Date.now() + Number(input.days) * 86_400_000).toISOString()
        : undefined,
    };
    const now = new Date().toISOString(),
      auditId = crypto.randomUUID();
    const event = {
      id: auditId,
      action: input.blocked ? 'account_blocked' : 'account_restored',
      entityType: 'account',
      entityId: profile.uid,
      actorId: user.uid,
      actorName: user.displayName,
      createdAt: now,
      detail: JSON.stringify({
        previous: {
          suspended: profile.suspended,
          suspendedUntil: profile.suspendedUntil,
        },
        next: {
          suspended: next.suspended,
          suspendedUntil: next.suspendedUntil,
          reason,
        },
      }),
    };
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO records(type,id,owner_id,payload,updated_at) SELECT 'auditLog',?,?,?,? WHERE EXISTS(SELECT 1 FROM profiles WHERE uid=? AND profile_json=?)",
      ).bind(
        auditId,
        user.uid,
        JSON.stringify(event),
        now,
        profile.uid,
        row!.profile_json,
      ),
      env.DB.prepare(
        'UPDATE profiles SET profile_json=?,updated_at=? WHERE uid=? AND profile_json=?',
      ).bind(JSON.stringify(next), now, profile.uid, row!.profile_json),
    ]);
    if (!results[1].meta.changes)
      return json({ error: 'The account changed. Refresh and retry.' }, 409);
    await publishChanges(
      ['admin', 'access', `user:${profile.uid}`],
      ['account', 'collaboration'],
    );
    return json({ profile: next });
  }
  return json({ error: 'Unknown administration operation.' }, 404);
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
export async function maintenanceGate(
  request: Request,
  apiOnly = false,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const isApi = path.startsWith('/api/cloudflare/');
  if (apiOnly && !isApi) return null;
  // Static files remain cacheable. Admin shell/auth must remain reachable for recovery.
  if (
    !isApi &&
    (path === '/Admin' ||
      path.startsWith('/Admin/') ||
      /\.[a-z0-9]{2,8}$/i.test(path) ||
      path.startsWith('/_'))
  )
    return null;
  if (
    isApi &&
    /^\/api\/cloudflare\/auth\/(session|login|logout|mfa|mfa-begin|mfa-complete)$/.test(
      path,
    )
  )
    return null;
  const settings = await siteOperations();
  if (!maintenanceActive(settings)) return null;
  const user = await currentUser(request);
  if (user?.role === 'super_admin' && user.mfaEnrolled && user.mfaVerified)
    return null;
  const headers = { 'cache-control': 'no-store', 'retry-after': '300' };
  if (isApi)
    return json(
      {
        error: settings.message,
        code: 'MAINTENANCE',
        endsAt: settings.ends_at,
      },
      503,
      headers,
    );
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance | Qraft</title><style>body{margin:0;background:#f3f5f8;color:#182239;font:16px system-ui;display:grid;place-items:center;min-height:100vh}main{max-width:540px;margin:24px;padding:40px;border-radius:24px;background:white;box-shadow:0 20px 60px #16243c12}small{color:#596580}h1{font-size:32px}p{line-height:1.8}a{color:#3658c9}</style><main><small>QRAFT · SYSTEM UPDATE</small><h1>We'll be back shortly</h1><p dir="auto">${escapeHtml(settings.message)}</p>${settings.ends_at ? `<p>Expected return: ${escapeHtml(settings.ends_at)} UTC</p>` : ''}<a href="/">Try again</a></main></html>`,
    {
      status: 503,
      headers: { ...headers, 'content-type': 'text/html;charset=utf-8' },
    },
  );
}

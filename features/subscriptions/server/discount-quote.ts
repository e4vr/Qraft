import { env } from 'cloudflare:workers';
import type { AppUser } from '@/lib/medguard-types';
import { ValidationError } from '@/server/http/errors';
import { getPlanLimits, type PlanId } from '../domain/plan-config';
export type Discount = {
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
export async function quote(
  user: AppUser,
  code: string,
  requestedPlan: PlanId = 'full_monthly',
) {
  if (requestedPlan === 'free')
    throw new ValidationError('Choose a paid plan.');
  const configured = await env.DB.prepare(
    'SELECT coalesce(price_halalas,price_sar_period*100) AS price,policy_json FROM plan_prices WHERE plan=?',
  )
    .bind(requestedPlan)
    .first<{ price: number; policy_json: string | null }>();
  let planName = getPlanLimits(requestedPlan).name;
  try {
    const policy = JSON.parse(configured?.policy_json || '{}') as {
      name?: unknown;
    };
    if (typeof policy.name === 'string' && policy.name.trim())
      planName = policy.name;
  } catch {
    /* Legacy catalog rows use the default plan name. */
  }
  const original =
    configured?.price ?? getPlanLimits(requestedPlan).priceSarPeriod * 100;
  const discount = code
    ? await env.DB.prepare(
        'SELECT * FROM discount_codes WHERE code=? COLLATE NOCASE',
      )
        .bind(code)
        .first<Discount>()
    : null;
  if (code && !discount) throw new ValidationError('Invalid discount code.');
  if (discount) {
    const now = new Date().toISOString();
    if (!discount.enabled)
      throw new ValidationError('This discount code is disabled.');
    if (discount.starts_at && Date.parse(discount.starts_at) > Date.parse(now))
      throw new ValidationError('This discount code is not active yet.');
    if (
      discount.expires_at &&
      Date.parse(discount.expires_at) <= Date.parse(now)
    )
      throw new ValidationError('This discount code has expired.');
    if (discount.max_uses !== null && discount.uses >= discount.max_uses)
      throw new ValidationError(
        'This discount code has reached its usage limit.',
      );
    const allowedPlans = JSON.parse(
      discount.allowed_plans || '[]',
    ) as unknown[];
    if (!allowedPlans.includes(requestedPlan))
      throw new ValidationError(
        'This code is not valid for the selected plan.',
      );
    const used = await env.DB.prepare(
      "SELECT count(*) AS n FROM subscription_events WHERE user_id=? AND code_id=? AND status='success' AND action='discount_redeemed'",
    )
      .bind(user.uid, discount.id)
      .first<{ n: number }>();
    if (discount.per_user !== null && (used?.n ?? 0) >= discount.per_user)
      throw new ValidationError(
        'You have reached the usage limit for this discount code.',
      );
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
    planName,
  };
}

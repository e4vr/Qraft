import { env } from 'cloudflare:workers';
import { serverPlanLimits } from '@/features/subscriptions/server/plan-policy';
import type { AppUser, MemberProfile } from './medguard-types';
import {
  highestPlan,
  isPlanId,
  type PlanId,
} from '@/features/subscriptions/domain/plan-config';

export type EffectiveEntitlement = {
  effectivePlan: PlanId;
  effectivePlanExpiresAt: string | null;
  subscriptionPlan: PlanId | null;
  rewardPlan: PlanId | null;
  adminPlan: PlanId | null;
  adminOverridePlan: PlanId | null;
};

export async function getEffectiveEntitlement(
  profile: Pick<MemberProfile, 'uid' | 'tier'>,
  now = new Date().toISOString(),
): Promise<EffectiveEntitlement> {
  const [subscription, reward, admin, override] = await env.DB.batch([
    env.DB.prepare(
      "SELECT plan,expires_at FROM subscriptions WHERE user_id=? AND status IN ('active','manually_activated') AND (expires_at IS NULL OR expires_at>?) LIMIT 1",
    ).bind(profile.uid, now),
    env.DB.prepare(
      "SELECT plan,expires_at FROM reward_passes WHERE user_id=? AND status='active' AND expires_at>? ORDER BY CASE plan WHEN 'full_quarterly' THEN 2 WHEN 'full_monthly' THEN 1 ELSE 0 END DESC LIMIT 1",
    ).bind(profile.uid, now),
    env.DB.prepare(
      "SELECT plan,expires_at FROM admin_plan_entitlements WHERE user_id=? AND active=1 AND (expires_at IS NULL OR expires_at>?) ORDER BY CASE plan WHEN 'full_quarterly' THEN 2 WHEN 'full_monthly' THEN 1 ELSE 0 END DESC LIMIT 1",
    ).bind(profile.uid, now),
    env.DB.prepare(
      'SELECT plan,expires_at FROM account_plan_overrides WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)',
    ).bind(profile.uid, now),
  ]);
  const overrideRow = override.results[0] as { plan?: unknown; expires_at?: string | null } | undefined;
  const subscriptionRow = subscription.results[0] as { plan?: unknown; expires_at?: string | null } | undefined;
  const rewardRow = reward.results[0] as { plan?: unknown; expires_at?: string | null } | undefined;
  const adminRow = admin.results[0] as { plan?: unknown; expires_at?: string | null } | undefined;
  const subscriptionPlan = isPlanId(subscriptionRow?.plan)
    ? subscriptionRow.plan
    : null;
  const rewardPlan = isPlanId(rewardRow?.plan) ? rewardRow.plan : null;
  const adminPlan = isPlanId(adminRow?.plan) ? adminRow.plan : null;
  const basePlan = isPlanId(profile.tier) ? profile.tier : 'free';
  const adminOverridePlan = isPlanId(overrideRow?.plan) ? overrideRow.plan : null;
  const effectivePlan = adminOverridePlan ?? highestPlan(
    basePlan,
    subscriptionPlan,
    rewardPlan,
    adminPlan,
  );
  const matchingExpirations = [
    subscriptionPlan === effectivePlan ? subscriptionRow?.expires_at : null,
    rewardPlan === effectivePlan ? rewardRow?.expires_at : null,
    adminPlan === effectivePlan ? adminRow?.expires_at : null,
  ].filter((value): value is string => Boolean(value));
  return {
    effectivePlan,
    effectivePlanExpiresAt: adminOverridePlan !== null ? overrideRow?.expires_at ?? null : matchingExpirations.length
      ? matchingExpirations.sort().at(-1) ?? null
      : null,
    subscriptionPlan,
    rewardPlan,
    adminPlan,
    adminOverridePlan,
  };
}

export async function applyEffectiveEntitlement(user: AppUser): Promise<AppUser> {
  const entitlement = await getEffectiveEntitlement(user);
  return {
    ...user,
    tier: entitlement.effectivePlan,
    planLimits:await serverPlanLimits(entitlement.effectivePlan),
    ...entitlement,
  };
}

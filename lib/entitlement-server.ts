import { env } from 'cloudflare:workers';
import type { AppUser, MemberProfile } from './medguard-types';
import { highestPlan, isPlanId, type PlanId } from './plan-config';

export type EffectiveEntitlement = {
  effectivePlan: PlanId;
  subscriptionPlan: PlanId | null;
  rewardPlan: PlanId | null;
  adminPlan: PlanId | null;
  reviewerBenefit: boolean;
};

export async function getEffectiveEntitlement(
  profile: Pick<MemberProfile, 'uid' | 'tier' | 'role' | 'platformRoles'>,
  now = new Date().toISOString(),
): Promise<EffectiveEntitlement> {
  const [subscription, reward, admin] = await env.DB.batch([
    env.DB.prepare(
      "SELECT plan FROM subscriptions WHERE user_id=? AND status IN ('active','manually_activated') AND (expires_at IS NULL OR expires_at>?) LIMIT 1",
    ).bind(profile.uid, now),
    env.DB.prepare(
      "SELECT plan FROM reward_passes WHERE user_id=? AND status='active' AND expires_at>? ORDER BY CASE plan WHEN 'unlimited' THEN 3 WHEN 'pro' THEN 2 WHEN 'lite' THEN 1 ELSE 0 END DESC LIMIT 1",
    ).bind(profile.uid, now),
    env.DB.prepare(
      "SELECT plan FROM admin_plan_entitlements WHERE user_id=? AND active=1 AND (expires_at IS NULL OR expires_at>?) ORDER BY CASE plan WHEN 'unlimited' THEN 3 WHEN 'pro' THEN 2 WHEN 'lite' THEN 1 ELSE 0 END DESC LIMIT 1",
    ).bind(profile.uid, now),
  ]);
  const subscriptionRow = subscription.results[0] as { plan?: unknown } | undefined;
  const rewardRow = reward.results[0] as { plan?: unknown } | undefined;
  const adminRow = admin.results[0] as { plan?: unknown } | undefined;
  const subscriptionPlan = isPlanId(subscriptionRow?.plan)
    ? subscriptionRow.plan
    : null;
  const rewardPlan = isPlanId(rewardRow?.plan) ? rewardRow.plan : null;
  const adminPlan = isPlanId(adminRow?.plan) ? adminRow.plan : null;
  const reviewerBenefit =
    profile.role === 'super_admin' ||
    profile.role === 'reviewer' ||
    profile.platformRoles.includes('reviewer');
  const basePlan = isPlanId(profile.tier) ? profile.tier : 'free';
  return {
    effectivePlan: highestPlan(
      basePlan,
      subscriptionPlan,
      rewardPlan,
      adminPlan,
      reviewerBenefit ? 'unlimited' : null,
    ),
    subscriptionPlan,
    rewardPlan,
    adminPlan,
    reviewerBenefit,
  };
}

export async function applyEffectiveEntitlement(user: AppUser): Promise<AppUser> {
  const entitlement = await getEffectiveEntitlement(user);
  return {
    ...user,
    tier: entitlement.effectivePlan,
    ...entitlement,
  };
}

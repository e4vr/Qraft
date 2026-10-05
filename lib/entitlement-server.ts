import { env } from 'cloudflare:workers';
import { serverPlanLimits } from '@/features/subscriptions/server/plan-policy';
import { accessSourcesCte, accessSourceTimes } from '@/features/subscriptions/server/access-sources';
import type { AppUser, MemberProfile } from './medguard-types';
import {
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
  accessRevision: number;
  accessRevokedAt: string | null;
  nextEntitlementChangeAt: string | null;
};

export async function getEffectiveEntitlement(
  profile: Pick<MemberProfile, 'uid' | 'tier'>,
  now = new Date().toISOString(),
): Promise<EffectiveEntitlement> {
  // Read the stored base tier, not an already resolved user tier. Revocation and
  // all access sources are evaluated from the same SQL snapshot.
  const row = await env.DB.prepare(`${accessSourcesCte('WHERE p.uid=?')}
    SELECT tier,effective_expires_at,next_change_at,paid_plan,reward_plan,admin_plan,override_plan,access_revision,access_revoked_at FROM resolved`)
    .bind(profile.uid, ...accessSourceTimes(now))
    .first<{ tier: unknown; effective_expires_at: string | null; paid_plan: unknown; reward_plan: unknown;
      admin_plan: unknown; override_plan: unknown; access_revision: number; access_revoked_at: string | null; next_change_at: string | null }>();
  const plan = (value: unknown) => isPlanId(value) ? value : null;
  return {
    effectivePlan: plan(row?.tier) ?? 'free',
    effectivePlanExpiresAt: row?.effective_expires_at ?? null,
    subscriptionPlan: plan(row?.paid_plan),
    rewardPlan: plan(row?.reward_plan),
    adminPlan: plan(row?.admin_plan),
    adminOverridePlan: plan(row?.override_plan),
    accessRevision: row?.access_revision ?? 0,
    accessRevokedAt: row?.access_revoked_at ?? null,
    nextEntitlementChangeAt: row?.next_change_at ?? null,
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

import {
  PLAN_LIMITS,
  rewardDurationLabel,
  type PlanId,
} from '@/features/subscriptions/domain/plan-config';

export type RewardPass = {
  id: string;
  plan: Exclude<PlanId, 'free'>;
  duration: number;
  duration_unit: 'month' | 'year';
  duration_days?: number | null;
  status: 'available' | 'active' | 'scheduled' | 'used' | 'expired' | 'cancelled';
  created_at: string;
  activated_at: string | null;
  starts_at?: string | null;
  expires_at: string | null;
  source: string;
};

export type GiftNotification = Pick<
  RewardPass,
  'id' | 'plan' | 'duration' | 'duration_unit' | 'duration_days' | 'created_at'
>;

export function rewardPassLabel(
  reward: Pick<
    RewardPass,
    'plan' | 'duration' | 'duration_unit' | 'duration_days'
  >,
) {
  return `${PLAN_LIMITS[reward.plan].name} · ${rewardDurationLabel({ duration: reward.duration, durationUnit: reward.duration_unit, durationDays: reward.duration_days })}`;
}

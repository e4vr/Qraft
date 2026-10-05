import { addCalendarDuration } from './calendar-duration';
import type { PlanId } from './plan-config';

export type DurationUnit = 'day' | 'month' | 'year';
export type ActivationCodeAudience = 'any' | 'member';
export type AccessGrant = {
  id: string;
  user_id: string;
  source: string;
  source_id: string;
  label: string;
  plan: PlanId;
  duration: number;
  duration_unit: DurationUnit;
  starts_at: string;
  expires_at: string;
  created_at: string;
  created_by: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
};
export type ActivationCode = {
  id: string;
  hint: string;
  name: string;
  duration: number;
  duration_unit: DurationUnit;
  plan: PlanId;
  bound_user_id: string | null;
  redeem_before: string | null;
  created_at: string;
  created_by: string;
  disabled_at: string | null;
  redeemed_at: string | null;
  redeemed_by: string | null;
  grant_id: string | null;
};
export type ActivationCodeListing = ActivationCode & {
  status: string;
  bound_user_name: string | null;
  bound_user_email: string | null;
};
export function validateDuration(
  value: unknown,
  unit: unknown,
): { duration: number; unit: DurationUnit } {
  const duration = Number(value);
  if (
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    !['day', 'month', 'year'].includes(String(unit)) ||
    duration > (unit === 'day' ? 730 : unit === 'month' ? 24 : 2)
  )
    throw new Error('Choose 1–730 days, 1–24 months, or 1–2 years.');
  return { duration, unit: unit as DurationUnit };
}
export function durationEnd(
  start: string,
  duration: number,
  unit: DurationUnit,
): string {
  validateDuration(duration, unit);
  if (!Number.isFinite(Date.parse(start)))
    throw new Error('Invalid start date.');
  return unit === 'day'
    ? new Date(Date.parse(start) + duration * 86400000).toISOString()
    : addCalendarDuration(start, duration, unit);
}
export function grantStatus(grant: AccessGrant, now = Date.now()) {
  return grant.revoked_at
    ? 'revoked'
    : Date.parse(grant.expires_at) <= now
      ? 'expired'
      : Date.parse(grant.starts_at) > now
        ? 'scheduled'
        : 'active';
}
export function codeStatus(code: ActivationCode, now = Date.now()) {
  return code.redeemed_at
    ? 'used'
    : code.disabled_at
      ? 'disabled'
      : code.redeem_before && Date.parse(code.redeem_before) <= now
        ? 'expired'
        : 'unused';
}
export const durationText = (duration: number, unit: DurationUnit) =>
  `${duration} ${unit}${duration === 1 ? '' : 's'}`;

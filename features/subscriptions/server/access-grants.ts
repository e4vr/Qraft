import { env } from 'cloudflare:workers';
import type { AppUser } from '@/lib/medguard-types';
import { cancelAccess, grantAccess } from './subscription-service';
import type { DurationUnit } from '../domain/access-model';
type Actor = Pick<AppUser, 'uid' | 'displayName'>;
export async function revokeCurrentAccess(
  actor: Actor,
  uid: string,
  reason: string,
  requestId: string,
) {
  const result = await cancelAccess(actor, {
    userId: uid,
    requestId,
    reason: reason || 'Administrator revoked access',
  });
  return { unchanged: Boolean(result.duplicate) };
}
export async function activateRewardAccess(
  actor: Actor,
  pass: {
    id: string;
    plan: 'full_monthly' | 'full_quarterly';
    duration: number;
    duration_unit: 'month' | 'year';
    duration_days: number | null;
  },
) {
  const requestId = 'activate-' + pass.id;
  const result = await grantAccess(actor, {
    userId: actor.uid,
    requestId: requestId.length <= 80 ? requestId : pass.id,
    duration: pass.duration_days ?? pass.duration,
    unit: (pass.duration_days ? 'day' : pass.duration_unit) as DurationUnit,
    source: 'reward',
    sourceId: pass.id,
    label: 'Reward / gift',
    plan: pass.plan,
    extra: (grant, now) => [
      env.DB.prepare(
        "INSERT INTO access_operation_guards(id,valid) SELECT ?,status='available' FROM reward_passes WHERE id=? AND user_id=?",
      ).bind('reward-' + pass.id, pass.id, actor.uid),
      env.DB.prepare(
        "UPDATE reward_passes SET status='active',activated_at=?,expires_at=? WHERE id=? AND user_id=?",
      ).bind(now, grant.expires_at, pass.id, actor.uid),
      env.DB.prepare('DELETE FROM access_operation_guards WHERE id=?').bind(
        'reward-' + pass.id,
      ),
    ],
  });
  return result;
}

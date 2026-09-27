import { env } from 'cloudflare:workers';
import {
  PLAN_LIMITS,
  type PlanId,
  type PlanLimits,
} from '../domain/plan-config';
export async function serverPlanLimits(plan: PlanId): Promise<PlanLimits> {
  const row = await env.DB.prepare(
    'SELECT policy_json FROM plan_prices WHERE plan=?',
  )
    .bind(plan)
    .first<{ policy_json: string | null }>();
  return {
    ...PLAN_LIMITS[plan],
    ...(row?.policy_json ? JSON.parse(row.policy_json) : {}),
  };
}

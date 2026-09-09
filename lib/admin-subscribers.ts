import { env } from 'cloudflare:workers';

const rank = (column: string) => `CASE ${column} WHEN 'unlimited' THEN 3 WHEN 'pro' THEN 2 WHEN 'lite' THEN 1 ELSE 0 END`;

// Resolve the same sources as getEffectiveEntitlement before filtering or paging.
export async function listAdminSubscribers(url: URL) {
  const now = new Date().toISOString();
  const sources = `WITH sources AS (
    SELECT p.uid,p.email,json_extract(p.profile_json,'$.displayName') AS name,
      json_extract(p.profile_json,'$.tier') AS base_plan,s.*,
      CASE WHEN s.status IN ('active','manually_activated') AND (s.expires_at IS NULL OR s.expires_at>?) THEN s.plan END AS paid_plan,
      (SELECT r.plan FROM reward_passes r WHERE r.user_id=p.uid AND r.status='active' AND r.expires_at>? ORDER BY ${rank('r.plan')} DESC LIMIT 1) AS reward_plan,
      (SELECT a.plan FROM admin_plan_entitlements a WHERE a.user_id=p.uid AND a.active=1 AND (a.expires_at IS NULL OR a.expires_at>?) ORDER BY ${rank('a.plan')} DESC LIMIT 1) AS admin_plan,
      o.plan AS override_plan,o.expires_at AS override_expires_at,o.reason AS override_reason
    FROM profiles p LEFT JOIN subscriptions s ON s.user_id=p.uid
    LEFT JOIN account_plan_overrides o ON o.user_id=p.uid AND (o.expires_at IS NULL OR o.expires_at>?)
  ), resolved AS (
    SELECT *,coalesce(override_plan,json_extract('["free","lite","pro","unlimited"]', '$[' || max(${rank('base_plan')},${rank('paid_plan')},${rank('reward_plan')},${rank('admin_plan')}) || ']')) AS tier FROM sources
  ), filtered AS (
    SELECT * FROM resolved WHERE (email LIKE ? OR name LIKE ? OR uid LIKE ?)
    AND (?='' OR tier=? OR coalesce(status,'none')=? OR (?='override' AND override_plan IS NOT NULL))
  )`;
  const search = `%${(url.searchParams.get('search') || '').slice(0, 100)}%`;
  const status = url.searchParams.get('status') || '';
  const args = [now, now, now, now, search, search, search, status, status, status, status];
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
  const sort = url.searchParams.get('sort') === 'name' ? 'email COLLATE NOCASE' : 'coalesce(override_expires_at,expires_at)';
  const [rows, totals] = await env.DB.batch([
    env.DB.prepare(`${sources} SELECT * FROM filtered ORDER BY ${sort},uid LIMIT 51 OFFSET ?`).bind(...args, offset),
    env.DB.prepare(`${sources} SELECT count(*) AS total,coalesce(sum(tier='free'),0) AS free,coalesce(sum(tier<>'free'),0) AS paid,coalesce(sum(override_plan IS NOT NULL),0) AS overrides FROM filtered`).bind(...args),
  ]);
  return { subscriptions: rows.results, summary: totals.results[0] };
}

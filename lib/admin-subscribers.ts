import { env } from 'cloudflare:workers';
import { accessSourcesCte, accessSourceTimes } from '@/features/subscriptions/server/access-sources';

// Resolve the same sources as getEffectiveEntitlement before filtering or paging.
export async function listAdminSubscribers(url: URL) {
  const now = new Date().toISOString();
  const sources = `${accessSourcesCte()}, filtered AS (
    SELECT * FROM resolved WHERE (instr(lower(coalesce(email,'')),lower(?))>0
      OR instr(lower(coalesce(name,'')),lower(?))>0 OR instr(lower(uid),lower(?))>0)
    AND (?='' OR tier=? OR coalesce(status,'none')=? OR (?='override' AND override_plan IS NOT NULL))
  )`;
  // D1 limits LIKE patterns; literal substring search also handles long IDs and
  // email addresses without interpreting user input as a wildcard pattern.
  const search = (url.searchParams.get('search') || '').slice(0, 100);
  const status = url.searchParams.get('status') || '';
  const args = [...accessSourceTimes(now), search, search, search, status, status, status, status];
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
  const sort = url.searchParams.get('sort') === 'name' ? 'email COLLATE NOCASE' : 'coalesce(effective_expires_at,expires_at)';
  const [rows, totals] = await env.DB.batch([
    env.DB.prepare(`${sources} SELECT * FROM filtered ORDER BY ${sort},uid LIMIT 51 OFFSET ?`).bind(...args, offset),
    env.DB.prepare(`${sources} SELECT count(*) AS total,coalesce(sum(tier='free'),0) AS free,coalesce(sum(tier<>'free'),0) AS paid,coalesce(sum(override_plan IS NOT NULL),0) AS overrides FROM filtered`).bind(...args),
  ]);
  return { subscriptions: rows.results, summary: totals.results[0] };
}

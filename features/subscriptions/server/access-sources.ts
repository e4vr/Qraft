// One ledger is authoritative; legacy profile tiers and billing rows cannot grant access.
export function accessSourcesCte(scope = '') {
  return `WITH access_scope AS (
    SELECT p.*,coalesce(a.version,0) AS access_revision FROM profiles p
    LEFT JOIN access_accounts a ON a.user_id=p.uid ${scope}
  ), clock AS (SELECT ? AS now,? AS t2,? AS t3,? AS t4,? AS t5), resolved AS (
    SELECT p.uid,p.email,json_extract(p.profile_json,'$.displayName') AS name,p.profile_json,
      p.access_revision,NULL AS access_revoked_at,'free' AS base_plan,
      CASE WHEN json_extract(p.profile_json,'$.role')='super_admin' THEN 'full_monthly'
        ELSE coalesce((SELECT CASE max(CASE g.plan WHEN 'full_quarterly' THEN 2 ELSE 1 END) WHEN 2 THEN 'full_quarterly' WHEN 1 THEN 'full_monthly' END
          FROM access_grants g WHERE g.user_id=p.uid AND g.revoked_at IS NULL AND g.starts_at<=clock.now AND g.expires_at>clock.now),'free') END AS tier,
      CASE WHEN json_extract(p.profile_json,'$.role')='super_admin' THEN NULL ELSE
        (SELECT max(g.expires_at) FROM access_grants g WHERE g.user_id=p.uid AND g.revoked_at IS NULL AND g.expires_at>clock.now) END AS effective_expires_at,
      (SELECT min(CASE WHEN g.starts_at>clock.now THEN g.starts_at ELSE g.expires_at END) FROM access_grants g
        WHERE g.user_id=p.uid AND g.revoked_at IS NULL AND g.expires_at>clock.now) AS next_change_at,
      NULL AS paid_plan,NULL AS reward_plan,NULL AS admin_plan,NULL AS override_plan,NULL AS override_expires_at,NULL AS override_reason,
      NULL AS status,NULL AS starts_at,NULL AS expires_at,NULL AS method,NULL AS discount_code,NULL AS paid,NULL AS plan
    FROM access_scope p CROSS JOIN clock
  )`;
}
export const accessSourceTimes = (now: string) => [now, now, now, now, now];
export const accessGenerationSql = (user: string) =>
  `coalesce((SELECT generation FROM account_access_revisions WHERE user_id=${user}),0)`;
export const rewardStatusSql = (alias = 'r') => `CASE
  WHEN ${alias}.status='active' THEN coalesce((SELECT CASE WHEN g.revoked_at IS NOT NULL THEN 'cancelled'
    WHEN g.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'expired'
    WHEN g.starts_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'scheduled' ELSE 'active' END
    FROM access_grants g WHERE g.source='reward' AND g.source_id=${alias}.id),'expired') ELSE ${alias}.status END`;
export const rewardWalletFields = (
  alias = 'r',
) => `${alias}.id,${alias}.plan,${alias}.duration,${alias}.duration_unit,${alias}.duration_days,
  ${rewardStatusSql(alias)} AS status,${alias}.created_at,${alias}.activated_at,
  coalesce((SELECT g.expires_at FROM access_grants g WHERE g.source='reward' AND g.source_id=${alias}.id),${alias}.expires_at) AS expires_at,
  (SELECT g.starts_at FROM access_grants g WHERE g.source='reward' AND g.source_id=${alias}.id) AS starts_at,${alias}.source`;

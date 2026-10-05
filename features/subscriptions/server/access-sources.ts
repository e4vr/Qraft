const plans = `'["free","full_monthly","full_quarterly"]'`;
const rank = (column: string) => `CASE ${column} WHEN 'full_quarterly' THEN 2 WHEN 'full_monthly' THEN 1 ELSE 0 END`;

// Shared by session access and the paginated administrative listing. An unused
// gift captures the current revision only when it actually grants access.
export function accessSourcesCte(scope = '') {
  const envelope = (table: string, condition: string) => `(SELECT json_object(
    'plan',json_extract(${plans},'$['||max(${rank('g.plan')})||']'),
    'expiresAt',CASE WHEN sum(g.expires_at IS NULL)>0 THEN NULL ELSE max(g.expires_at) END)
    FROM ${table} g WHERE g.user_id=p.uid AND g.access_generation=p.access_revision AND ${condition})`;
  return `WITH access_scope AS (
    SELECT p.*,coalesce(a.generation,0) AS access_revision,a.revoked_at AS access_revoked_at
    FROM profiles p LEFT JOIN account_access_revisions a ON a.user_id=p.uid ${scope}
  ), source_envelopes AS (
    SELECT p.uid,p.email,json_extract(p.profile_json,'$.displayName') AS name,
      CASE WHEN p.access_revision=0 THEN json_extract(p.profile_json,'$.tier') ELSE 'free' END AS base_plan,
      p.access_revision,p.access_revoked_at,s.*,
      CASE WHEN s.access_generation=p.access_revision AND s.status IN ('active','manually_activated')
        AND (s.expires_at IS NULL OR s.expires_at>?) THEN json_object('plan',s.plan,'expiresAt',s.expires_at) END AS paid_source,
      ${envelope('reward_passes', "g.status='active' AND g.expires_at>?")} AS reward_source,
      ${envelope('admin_plan_entitlements', 'g.active=1 AND (g.expires_at IS NULL OR g.expires_at>?)')} AS admin_source,
      CASE WHEN o.plan<>'free' AND o.access_generation=p.access_revision AND (o.expires_at IS NULL OR o.expires_at>?)
        THEN json_object('plan',o.plan,'expiresAt',o.expires_at) END AS override_source,
      CASE WHEN o.plan<>'free' AND o.access_generation=p.access_revision AND (o.expires_at IS NULL OR o.expires_at>?) THEN o.reason END AS override_reason
    FROM access_scope p LEFT JOIN subscriptions s ON s.user_id=p.uid LEFT JOIN account_plan_overrides o ON o.user_id=p.uid
  ), sources AS (
    SELECT *,json_extract(paid_source,'$.plan') AS paid_plan,
      json_extract(reward_source,'$.plan') AS reward_plan,json_extract(admin_source,'$.plan') AS admin_plan,
      json_extract(override_source,'$.plan') AS override_plan,json_extract(override_source,'$.expiresAt') AS override_expires_at
    FROM source_envelopes
  ), access_levels AS (
    SELECT *,coalesce(override_plan,json_extract(${plans},'$['||max(${rank('base_plan')},${rank('paid_plan')},${rank('reward_plan')},${rank('admin_plan')})||']')) AS tier FROM sources
  ), resolved AS (
    SELECT *,CASE WHEN tier='free' OR base_plan IN ('full_monthly','full_quarterly')
      OR (paid_plan IS NOT NULL AND json_extract(paid_source,'$.expiresAt') IS NULL)
      OR (reward_plan IS NOT NULL AND json_extract(reward_source,'$.expiresAt') IS NULL)
      OR (admin_plan IS NOT NULL AND json_extract(admin_source,'$.expiresAt') IS NULL)
      OR (override_plan IS NOT NULL AND override_expires_at IS NULL) THEN NULL
      ELSE nullif(max(coalesce(json_extract(paid_source,'$.expiresAt'),''),coalesce(json_extract(reward_source,'$.expiresAt'),''),
        coalesce(json_extract(admin_source,'$.expiresAt'),''),coalesce(override_expires_at,'')),'') END AS effective_expires_at
    FROM access_levels
  )`;
}

export const accessSourceTimes = (now: string) => [now, now, now, now, now];
export const accessGenerationSql = (user: string) => `coalesce((SELECT generation FROM account_access_revisions WHERE user_id=${user}),0)`;
export const rewardStatusSql = (alias = 'r') => `CASE WHEN ${alias}.status='active' AND ${alias}.access_generation<>${accessGenerationSql(`${alias}.user_id`)} THEN 'cancelled' ELSE ${alias}.status END`;
export const rewardWalletFields = (alias = 'r') => `${alias}.id,${alias}.plan,${alias}.duration,${alias}.duration_unit,${alias}.duration_days,
  ${rewardStatusSql(alias)} AS status,${alias}.created_at,${alias}.activated_at,${alias}.expires_at,${alias}.source`;

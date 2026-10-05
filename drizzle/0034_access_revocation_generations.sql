-- Revocation invalidates existing access, while later activations remain valid.
-- Keep financial history and all gift activation/expiration dates unchanged.
CREATE TABLE account_access_revisions (
  user_id TEXT PRIMARY KEY REFERENCES profiles(uid) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK(generation>=1),
  revoked_at TEXT NOT NULL,
  revoked_by TEXT NOT NULL
);

ALTER TABLE subscriptions ADD COLUMN access_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reward_passes ADD COLUMN access_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_plan_entitlements ADD COLUMN access_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_plan_overrides ADD COLUMN access_generation INTEGER NOT NULL DEFAULT 0;

-- Convert only currently effective legacy Free assignments. An expired legacy
-- assignment must not retroactively revoke the access that already resumed.
INSERT INTO account_access_revisions(user_id,generation,revoked_at,revoked_by)
SELECT user_id,1,updated_at,updated_by FROM account_plan_overrides
WHERE plan='free' AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'));

-- A later paid assignment must not erase a prior permanent/current revocation.
-- Reconstruct those replaced Free assignments from their server audit records.
WITH candidates AS (
  SELECT json_extract(payload,'$.entityId') AS user_id,
    json_extract(payload,'$.createdAt') AS revoked_at,json_extract(payload,'$.actorId') AS revoked_by,
    CASE WHEN json_valid(json_extract(payload,'$.detail')) THEN json_extract(json_extract(payload,'$.detail'),'$.next.plan') END AS plan,
    CASE WHEN json_valid(json_extract(payload,'$.detail')) THEN json_extract(json_extract(payload,'$.detail'),'$.next.expires_at') END AS expires_at
  FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='subscription_plan_overridden'
), ranked AS (
  SELECT *,row_number() OVER(PARTITION BY user_id ORDER BY revoked_at DESC) AS position
  FROM candidates WHERE plan='free' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL
)
INSERT INTO account_access_revisions(user_id,generation,revoked_at,revoked_by)
SELECT r.user_id,1,r.revoked_at,r.revoked_by FROM ranked r JOIN account_plan_overrides o ON o.user_id=r.user_id
WHERE r.position=1 AND o.plan<>'free' AND julianday(o.updated_at)>julianday(r.revoked_at)
  AND (r.expires_at IS NULL OR julianday(r.expires_at)>julianday('now'))
  AND NOT EXISTS(SELECT 1 FROM account_access_revisions a WHERE a.user_id=r.user_id);

-- A gift activated AFTER the legacy revocation is a new grant. A gift that was
-- already active at revocation stays revoked, and unused gifts stay available.
UPDATE reward_passes SET access_generation=1 WHERE status='active' AND EXISTS(
  SELECT 1 FROM account_access_revisions a WHERE a.user_id=reward_passes.user_id
    AND julianday(reward_passes.activated_at)>julianday(a.revoked_at)
);
UPDATE admin_plan_entitlements SET access_generation=1 WHERE active=1 AND EXISTS(
  SELECT 1 FROM account_access_revisions a WHERE a.user_id=admin_plan_entitlements.user_id
    AND julianday(admin_plan_entitlements.created_at)>julianday(a.revoked_at)
);
UPDATE subscriptions SET access_generation=1 WHERE status IN ('active','manually_activated') AND EXISTS(
  SELECT 1 FROM account_access_revisions a JOIN subscription_events e ON e.user_id=a.user_id
  WHERE a.user_id=subscriptions.user_id AND e.status='success'
    AND e.action IN ('discount_redeemed','subscription_manually_activated')
    AND e.expires_at IS subscriptions.expires_at
    AND julianday(e.created_at)>julianday(a.revoked_at)
);
UPDATE account_plan_overrides SET access_generation=1
WHERE user_id IN (SELECT user_id FROM account_access_revisions);

-- Stamp discount access inside the same transaction as discount redemption.
-- Replaying an existing subscription event never executes this INSERT again.
DROP TRIGGER complete_discount;
CREATE TRIGGER complete_discount AFTER INSERT ON subscription_events
WHEN NEW.action='discount_redeemed' AND NEW.status='success'
BEGIN
  UPDATE discount_codes SET uses=uses+1 WHERE id=NEW.code_id;
  INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,discount_code,paid,updated_at,plan,access_generation)
  VALUES(NEW.user_id,'active',NEW.starts_at,NEW.expires_at,IIF(NEW.admin_id IS NULL,'discount','manual'),NEW.code,NEW.final,NEW.created_at,NEW.plan,
    coalesce((SELECT generation FROM account_access_revisions WHERE user_id=NEW.user_id),0))
  ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,starts_at=excluded.starts_at,expires_at=excluded.expires_at,
    method=excluded.method,discount_code=excluded.discount_code,paid=excluded.paid,updated_at=excluded.updated_at,
    plan=excluded.plan,access_generation=excluded.access_generation;
END;

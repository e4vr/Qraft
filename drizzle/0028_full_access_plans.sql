-- Full Access replaces the retired commercial catalog. Preserve IDs, balances,
-- payment amounts, audit history, existing access and expiration dates.
PRAGMA defer_foreign_keys=ON;

DROP TRIGGER IF EXISTS complete_discount;

DROP TRIGGER IF EXISTS sync_legacy_plan_price;

DROP TRIGGER IF EXISTS redeem_discount;

CREATE TABLE subscriptions_full_access (user_id TEXT PRIMARY KEY REFERENCES profiles(uid), status TEXT NOT NULL, starts_at TEXT, expires_at TEXT, method TEXT NOT NULL, discount_code TEXT, paid INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'full_monthly');

INSERT INTO subscriptions_full_access(user_id,status,starts_at,expires_at,method,discount_code,paid,updated_at,plan) SELECT user_id,status,starts_at,expires_at,method,discount_code,paid,updated_at,CASE plan WHEN 'lite' THEN 'full_monthly' WHEN 'pro' THEN 'full_monthly' WHEN 'unlimited' THEN 'full_quarterly' ELSE plan END FROM subscriptions;

DROP TABLE subscriptions;

ALTER TABLE subscriptions_full_access RENAME TO subscriptions;

CREATE INDEX idx_subscriptions_expiration ON subscriptions(status,expires_at);

CREATE TABLE subscription_events_full_access (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, admin_id TEXT, code_id TEXT, code TEXT, action TEXT NOT NULL, original INTEGER NOT NULL, discount INTEGER NOT NULL, final INTEGER NOT NULL, status TEXT NOT NULL, starts_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, detail TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'full_monthly');

INSERT INTO subscription_events_full_access(id,user_id,email,name,admin_id,code_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail,plan) SELECT id,user_id,email,name,admin_id,code_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail,CASE plan WHEN 'lite' THEN 'full_monthly' WHEN 'pro' THEN 'full_monthly' WHEN 'unlimited' THEN 'full_quarterly' ELSE plan END FROM subscription_events;

DROP TABLE subscription_events;

ALTER TABLE subscription_events_full_access RENAME TO subscription_events;

CREATE INDEX idx_subscription_events_user_code ON subscription_events(user_id,code_id,status);

CREATE INDEX idx_subscription_events_code ON subscription_events(code_id,created_at);

CREATE TABLE reward_passes_full_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('full_monthly','full_quarterly')),
  duration INTEGER NOT NULL CHECK(duration>0),
  duration_unit TEXT NOT NULL CHECK(duration_unit IN ('month','year')),
  status TEXT NOT NULL CHECK(status IN ('available','active','used','expired','cancelled')),
  created_at TEXT NOT NULL,
  activated_at TEXT,
  expires_at TEXT,
  source TEXT NOT NULL,
  credit_transaction_id TEXT UNIQUE REFERENCES credit_transactions(id),
  metadata TEXT NOT NULL DEFAULT '{}'
, duration_days INTEGER CHECK(duration_days BETWEEN 1 AND 730));

INSERT INTO reward_passes_full_access(id,user_id,plan,duration,duration_unit,status,created_at,activated_at,expires_at,source,credit_transaction_id,metadata,duration_days) SELECT id,user_id,CASE plan WHEN 'lite' THEN 'full_monthly' WHEN 'pro' THEN 'full_monthly' WHEN 'unlimited' THEN 'full_quarterly' ELSE plan END,duration,duration_unit,status,created_at,activated_at,expires_at,source,credit_transaction_id,metadata,duration_days FROM reward_passes;

DROP TABLE reward_passes;

ALTER TABLE reward_passes_full_access RENAME TO reward_passes;

CREATE INDEX idx_reward_passes_user_status ON reward_passes(user_id,status,expires_at);

CREATE TABLE admin_plan_entitlements_full_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('full_monthly','full_quarterly')),
  active INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

INSERT INTO admin_plan_entitlements_full_access(id,user_id,plan,active,reason,granted_by,created_at,expires_at) SELECT id,user_id,CASE plan WHEN 'lite' THEN 'full_monthly' WHEN 'pro' THEN 'full_monthly' WHEN 'unlimited' THEN 'full_quarterly' ELSE plan END,active,reason,granted_by,created_at,expires_at FROM admin_plan_entitlements;

DROP TABLE admin_plan_entitlements;

ALTER TABLE admin_plan_entitlements_full_access RENAME TO admin_plan_entitlements;

CREATE INDEX idx_admin_plan_entitlements_user ON admin_plan_entitlements(user_id,active,expires_at);

CREATE TABLE account_plan_overrides_full_access (
  user_id TEXT PRIMARY KEY REFERENCES profiles(uid) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('free','full_monthly','full_quarterly')),
  expires_at TEXT,
  reason TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO account_plan_overrides_full_access(user_id,plan,expires_at,reason,updated_by,updated_at) SELECT user_id,CASE plan WHEN 'lite' THEN 'full_monthly' WHEN 'pro' THEN 'full_monthly' WHEN 'unlimited' THEN 'full_quarterly' ELSE plan END,expires_at,reason,updated_by,updated_at FROM account_plan_overrides;

DROP TABLE account_plan_overrides;

ALTER TABLE account_plan_overrides_full_access RENAME TO account_plan_overrides;

CREATE TABLE discount_codes_full_access (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')), amount INTEGER NOT NULL CHECK(amount>=0), enabled INTEGER NOT NULL DEFAULT 1, starts_at TEXT, expires_at TEXT, max_uses INTEGER CHECK(max_uses IS NULL OR max_uses>0), per_user INTEGER CHECK(per_user IS NULL OR per_user>0), uses INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, allowed_plans TEXT NOT NULL DEFAULT '["full_monthly","full_quarterly"]', CHECK(kind!='percent' OR amount<=100));

INSERT INTO discount_codes_full_access(id,code,kind,amount,enabled,starts_at,expires_at,max_uses,per_user,uses,updated_at,allowed_plans)
SELECT id,code,kind,amount,enabled,starts_at,expires_at,max_uses,per_user,uses,updated_at,
  (SELECT json_group_array(mapped_plan) FROM (
    SELECT DISTINCT CASE value WHEN 'lite' THEN 'full_monthly' WHEN 'pro' THEN 'full_monthly' WHEN 'unlimited' THEN 'full_quarterly' ELSE value END AS mapped_plan
    FROM json_each(discount_codes.allowed_plans)
    WHERE value IN ('lite','pro','unlimited','full_monthly','full_quarterly')
    ORDER BY mapped_plan
  ))
FROM discount_codes;

DROP TABLE discount_codes;

ALTER TABLE discount_codes_full_access RENAME TO discount_codes;

CREATE TABLE plan_prices_full_access (
  plan TEXT PRIMARY KEY CHECK(plan IN ('free','full_monthly','full_quarterly')),
  price_sar_period INTEGER NOT NULL CHECK(price_sar_period>=0),
  updated_at TEXT NOT NULL
, price_halalas INTEGER, policy_json TEXT);

INSERT INTO plan_prices_full_access(plan,price_sar_period,price_halalas,updated_at,policy_json) VALUES
('free',0,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL),
('full_monthly',100,10000,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL),
('full_quarterly',230,23000,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL);

DROP TABLE plan_prices;

ALTER TABLE plan_prices_full_access RENAME TO plan_prices;

UPDATE profiles SET profile_json=json_set(profile_json,'$.tier',CASE json_extract(profile_json,'$.tier') WHEN 'unlimited' THEN 'full_quarterly' ELSE 'full_monthly' END) WHERE json_extract(profile_json,'$.tier') IN ('lite','pro','unlimited');

UPDATE records SET payload=json_set(payload,'$.tier',CASE json_extract(payload,'$.tier') WHEN 'unlimited' THEN 'full_quarterly' ELSE 'full_monthly' END) WHERE type='profiles' AND json_extract(payload,'$.tier') IN ('lite','pro','unlimited');

UPDATE subscription_settings SET price=10000 WHERE id=1;

CREATE TRIGGER complete_discount AFTER INSERT ON subscription_events
WHEN NEW.action='discount_redeemed' AND NEW.status='success'
BEGIN
  UPDATE discount_codes SET uses=uses+1 WHERE id=NEW.code_id;
  INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,discount_code,paid,updated_at,plan)
  VALUES(NEW.user_id,'active',NEW.starts_at,NEW.expires_at,IIF(NEW.admin_id IS NULL,'discount','manual'),NEW.code,NEW.final,NEW.created_at,NEW.plan)
  ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,starts_at=excluded.starts_at,expires_at=excluded.expires_at,method=excluded.method,discount_code=excluded.discount_code,paid=excluded.paid,updated_at=excluded.updated_at,plan=excluded.plan;
END;

CREATE TRIGGER sync_plan_period_price AFTER UPDATE OF price_sar_period ON plan_prices
WHEN NEW.price_halalas IS NOT CAST(round(NEW.price_sar_period*100) AS INTEGER)
BEGIN
 UPDATE plan_prices SET price_halalas=CAST(round(NEW.price_sar_period*100) AS INTEGER) WHERE plan=NEW.plan;
END;

CREATE TRIGGER redeem_discount BEFORE INSERT ON subscription_events
WHEN NEW.action='discount_redeemed' AND NEW.status='success'
BEGIN
  SELECT RAISE(ABORT,'DISCOUNT_UNAVAILABLE') WHERE NOT EXISTS(
    SELECT 1 FROM discount_codes d
    WHERE d.id=NEW.code_id
      AND d.enabled=1
      AND EXISTS(SELECT 1 FROM json_each(d.allowed_plans) WHERE value=NEW.plan)
      AND (d.starts_at IS NULL OR d.starts_at<=NEW.created_at)
      AND (d.expires_at IS NULL OR d.expires_at>NEW.created_at)
      AND (d.max_uses IS NULL OR d.uses<d.max_uses)
      AND (d.per_user IS NULL OR (
        SELECT count(*) FROM subscription_events e
        WHERE e.code_id=d.id AND e.user_id=NEW.user_id
          AND e.status='success' AND e.action='discount_redeemed'
      )<d.per_user)
      AND NEW.original=(SELECT coalesce(price_halalas,CAST(round(price_sar_period*100) AS INTEGER)) FROM plan_prices WHERE plan=NEW.plan)
      AND NEW.final=MAX(0,NEW.original-IIF(d.kind='percent',CAST((NEW.original*d.amount+50)/100 AS INTEGER),d.amount))
      AND NEW.discount=NEW.original-NEW.final
  );
END;

PRAGMA defer_foreign_keys=OFF;

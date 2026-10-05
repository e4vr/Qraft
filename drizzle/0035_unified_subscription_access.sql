-- Authorized clean start for subscription/access history. Study data, prices,
-- reward catalog and contribution balances are outside this reset.
DELETE FROM reward_passes;
DELETE FROM admin_plan_entitlements;
DELETE FROM account_plan_overrides;
DELETE FROM subscriptions;
DELETE FROM subscription_events;
DELETE FROM account_access_revisions;
DELETE FROM records WHERE type='auditLog' AND (
 json_extract(payload,'$.action') LIKE 'subscription_%'
 OR json_extract(payload,'$.action') LIKE 'reward_%'
 OR json_extract(payload,'$.action')='discount_redeemed');
UPDATE profiles SET profile_json=json_set(profile_json,'$.tier','free') WHERE coalesce(json_extract(profile_json,'$.role'),'')<>'super_admin';
UPDATE records SET payload=json_set(payload,'$.tier','free') WHERE type='profiles' AND coalesce(json_extract(payload,'$.role'),'')<>'super_admin';
UPDATE discount_codes SET uses=0;
ALTER TABLE test_registry ADD COLUMN plan_at_start TEXT NOT NULL DEFAULT 'free';
ALTER TABLE test_registry ADD COLUMN question_ids_json TEXT;
UPDATE test_registry SET question_ids_json=(
 SELECT json_extract(t.value,'$.questionIds') FROM app_states s,json_each(s.payload,'$.tests') t
 WHERE s.user_id=test_registry.user_id AND json_extract(t.value,'$.id')=test_registry.test_id
);
-- Coupons record manual confirmations; only access_grants can activate access.
DROP TRIGGER complete_discount;
CREATE TRIGGER complete_discount AFTER INSERT ON subscription_events
WHEN NEW.action='discount_redeemed' AND NEW.status='success'
BEGIN
 UPDATE discount_codes SET uses=uses+1 WHERE id=NEW.code_id;
END;

CREATE TABLE access_accounts (
 user_id TEXT PRIMARY KEY REFERENCES profiles(uid) ON DELETE CASCADE,
 version INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);
CREATE TABLE access_grants (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
 source TEXT NOT NULL,
 source_id TEXT NOT NULL,
 label TEXT NOT NULL,
 plan TEXT NOT NULL,
 duration INTEGER NOT NULL CHECK(duration BETWEEN 1 AND 730),
 duration_unit TEXT NOT NULL CHECK(duration_unit IN ('day','month','year')),
 starts_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 revoked_at TEXT,
 revoked_by TEXT,
 revoke_reason TEXT,
 UNIQUE(source,source_id)
);
CREATE INDEX idx_access_grants_user_end ON access_grants(user_id,expires_at);
CREATE TABLE activation_codes (
 id TEXT PRIMARY KEY,
 code_hash TEXT NOT NULL UNIQUE,
 hint TEXT NOT NULL,
 name TEXT NOT NULL,
 duration INTEGER NOT NULL CHECK(duration BETWEEN 1 AND 730),
 duration_unit TEXT NOT NULL CHECK(duration_unit IN ('day','month','year')),
 plan TEXT NOT NULL,
 bound_user_id TEXT,
 redeem_before TEXT,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 disabled_at TEXT,
 redeemed_at TEXT,
 redeemed_by TEXT,
 grant_id TEXT,
 operation_id TEXT NOT NULL UNIQUE
);
CREATE INDEX idx_activation_codes_created ON activation_codes(created_at);
CREATE TABLE access_operations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 action TEXT NOT NULL,
 created_at TEXT NOT NULL,
 result_json TEXT NOT NULL
);
CREATE INDEX idx_access_operations_user_created ON access_operations(user_id,created_at);
CREATE TABLE access_payments (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 grant_id TEXT,
 code_id TEXT,
 amount INTEGER NOT NULL CHECK(amount>=0),
 reference TEXT NOT NULL,
 confirmed_by TEXT NOT NULL,
 confirmed_at TEXT NOT NULL
);
CREATE INDEX idx_access_payments_user_time ON access_payments(user_id,confirmed_at);
CREATE TABLE access_operation_guards (
 id TEXT PRIMARY KEY,
 valid INTEGER NOT NULL CHECK(valid=1)
);

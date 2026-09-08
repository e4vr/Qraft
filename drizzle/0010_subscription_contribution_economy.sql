-- Additive subscription, usage and contribution economy foundation.
ALTER TABLE subscriptions ADD COLUMN plan TEXT NOT NULL DEFAULT 'pro';
ALTER TABLE subscription_events ADD COLUMN plan TEXT NOT NULL DEFAULT 'pro';
ALTER TABLE discount_codes ADD COLUMN allowed_plans TEXT NOT NULL DEFAULT '["lite","pro","unlimited"]';
ALTER TABLE test_registry ADD COLUMN started_at TEXT;
ALTER TABLE imported_files ADD COLUMN daily_limit INTEGER NOT NULL DEFAULT 1000000;
ALTER TABLE imported_files ADD COLUMN pending_limit INTEGER NOT NULL DEFAULT 1000000;

UPDATE test_registry
SET started_at=COALESCE(
  (SELECT json_extract(test.value,'$.startedAt')
   FROM app_states, json_each(app_states.payload,'$.tests') AS test
   WHERE app_states.user_id=test_registry.user_id
     AND json_extract(test.value,'$.id')=test_registry.test_id
   LIMIT 1),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
WHERE started_at IS NULL;

DROP TRIGGER IF EXISTS enforce_lite_test_limit;
DROP TRIGGER IF EXISTS enforce_lite_state;
DROP TRIGGER IF EXISTS redeem_discount;
DROP TRIGGER IF EXISTS complete_discount;

CREATE TRIGGER enforce_json_import_limits BEFORE INSERT ON imported_files
BEGIN
  SELECT RAISE(ABORT,'JSON_IMPORT_DAILY_LIMIT')
  WHERE (
    SELECT count(*) FROM imported_files
    WHERE user_id=NEW.user_id
      AND substr(uploaded_at,1,10)=substr(NEW.uploaded_at,1,10)
  )>=NEW.daily_limit;
  SELECT RAISE(ABORT,'JSON_IMPORT_PENDING_LIMIT')
  WHERE (
    SELECT count(*) FROM records
    WHERE type='questionProposals'
      AND owner_id=NEW.user_id
      AND json_extract(payload,'$.status')='pending'
  )+NEW.successful_count>NEW.pending_limit;
END;

CREATE TABLE plan_prices (
  plan TEXT PRIMARY KEY CHECK(plan IN ('free','lite','pro','unlimited')),
  price_sar_year INTEGER NOT NULL CHECK(price_sar_year>=0),
  updated_at TEXT NOT NULL
);
INSERT INTO plan_prices(plan,price_sar_year,updated_at) VALUES
  ('free',0,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('lite',15,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('pro',50,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('unlimited',99,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

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
      AND NEW.original=(SELECT price_sar_year*100 FROM plan_prices WHERE plan=NEW.plan)
      AND NEW.final=MAX(0,NEW.original-IIF(d.kind='percent',CAST((NEW.original*d.amount+50)/100 AS INTEGER),d.amount))
      AND NEW.discount=NEW.original-NEW.final
  );
END;

CREATE TRIGGER complete_discount AFTER INSERT ON subscription_events
WHEN NEW.action='discount_redeemed' AND NEW.status='success'
BEGIN
  UPDATE discount_codes SET uses=uses+1 WHERE id=NEW.code_id;
  INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,discount_code,paid,updated_at,plan)
  VALUES(NEW.user_id,'active',NEW.starts_at,NEW.expires_at,IIF(NEW.admin_id IS NULL,'discount','manual'),NEW.code,NEW.final,NEW.created_at,NEW.plan)
  ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,starts_at=excluded.starts_at,expires_at=excluded.expires_at,method=excluded.method,discount_code=excluded.discount_code,paid=excluded.paid,updated_at=excluded.updated_at,plan=excluded.plan;
END;

CREATE TABLE contribution_accounts (
  user_id TEXT PRIMARY KEY REFERENCES profiles(uid) ON DELETE CASCADE,
  credits_balance INTEGER NOT NULL DEFAULT 0 CHECK(credits_balance>=0),
  lifetime_score INTEGER NOT NULL DEFAULT 0 CHECK(lifetime_score>=0),
  trust_score INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL
);

CREATE TABLE credit_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK(amount<>0),
  lifetime_delta INTEGER NOT NULL DEFAULT 0 CHECK(lifetime_delta>=0),
  type TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  reference_type TEXT,
  reference_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_credit_transactions_user_created ON credit_transactions(user_id,created_at DESC);
CREATE UNIQUE INDEX idx_credit_transactions_reference ON credit_transactions(user_id,type,reference_type,reference_id) WHERE reference_id IS NOT NULL;

CREATE TRIGGER credit_balance_guard BEFORE INSERT ON credit_transactions
WHEN NEW.amount<0
BEGIN
  SELECT RAISE(ABORT,'INSUFFICIENT_CREDITS')
  WHERE COALESCE((SELECT credits_balance FROM contribution_accounts WHERE user_id=NEW.user_id),0)+NEW.amount<0;
END;

CREATE TRIGGER apply_credit_transaction AFTER INSERT ON credit_transactions
BEGIN
  INSERT OR IGNORE INTO contribution_accounts(user_id,credits_balance,lifetime_score,trust_score,updated_at)
  VALUES(NEW.user_id,0,0,100,NEW.created_at);
  UPDATE contribution_accounts SET
    credits_balance=credits_balance+NEW.amount,
    lifetime_score=lifetime_score+NEW.lifetime_delta,
    updated_at=NEW.created_at
  WHERE user_id=NEW.user_id;
END;

CREATE TABLE reward_passes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('lite','pro','unlimited')),
  duration INTEGER NOT NULL CHECK(duration>0),
  duration_unit TEXT NOT NULL CHECK(duration_unit IN ('month','year')),
  status TEXT NOT NULL CHECK(status IN ('available','active','used','expired','cancelled')),
  created_at TEXT NOT NULL,
  activated_at TEXT,
  expires_at TEXT,
  source TEXT NOT NULL,
  credit_transaction_id TEXT UNIQUE REFERENCES credit_transactions(id),
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_reward_passes_user_status ON reward_passes(user_id,status,expires_at);

CREATE TABLE admin_plan_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('lite','pro','unlimited')),
  active INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX idx_admin_plan_entitlements_user ON admin_plan_entitlements(user_id,active,expires_at);

CREATE TABLE json_import_suspensions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  removed_at TEXT,
  removed_by TEXT
);
CREATE INDEX idx_json_import_suspensions_user ON json_import_suspensions(user_id,starts_at,ends_at);

CREATE TABLE duplicate_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('file','question')),
  content_hash TEXT NOT NULL,
  reference_id TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_duplicate_attempts_user_created ON duplicate_attempts(user_id,confirmed,created_at);

CREATE TABLE contribution_reviews (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','needs_changes')),
  high_risk INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX idx_contribution_reviews_independent ON contribution_reviews(proposal_id,reviewer_id);
CREATE INDEX idx_contribution_reviews_reviewer_created ON contribution_reviews(reviewer_id,created_at);

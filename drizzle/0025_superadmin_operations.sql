-- Operational settings and bounded monitoring snapshots, never a click log.
CREATE TABLE site_operations (
  id INTEGER PRIMARY KEY CHECK(id=1),
  maintenance INTEGER NOT NULL DEFAULT 0 CHECK(maintenance IN (0,1)),
  message TEXT NOT NULL DEFAULT 'Qraft is undergoing scheduled maintenance. Please check back shortly.',
  ends_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
INSERT INTO site_operations(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE monitoring_identities (
  telemetry_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES profiles(uid) ON DELETE CASCADE
);
CREATE TABLE monitoring_snapshots (
  period INTEGER PRIMARY KEY CHECK(period IN (1,7,30)),
  payload TEXT,
  refreshed_at TEXT,
  refresh_after TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'unavailable'
);
INSERT INTO monitoring_snapshots(period) VALUES(1),(7),(30);
CREATE TABLE monitoring_query_budget (
  day TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used BETWEEN 0 AND 60)
);

-- Store money in minor units while retaining existing annual-price consumers.
ALTER TABLE plan_prices ADD COLUMN price_halalas INTEGER;
ALTER TABLE plan_prices ADD COLUMN policy_json TEXT;
UPDATE plan_prices SET price_halalas=price_sar_year*100;

-- Day-based gifts preserve existing reward identifiers and foreign keys.
ALTER TABLE reward_passes ADD COLUMN duration_days INTEGER CHECK(duration_days BETWEEN 1 AND 730);


CREATE TRIGGER sync_legacy_plan_price AFTER UPDATE OF price_sar_year ON plan_prices
WHEN NEW.price_halalas IS NOT CAST(round(NEW.price_sar_year*100) AS INTEGER)
BEGIN
 UPDATE plan_prices SET price_halalas=CAST(round(NEW.price_sar_year*100) AS INTEGER) WHERE plan=NEW.plan;
END;

DROP TRIGGER IF EXISTS redeem_discount;
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
      AND NEW.original=(SELECT coalesce(price_halalas,CAST(round(price_sar_year*100) AS INTEGER)) FROM plan_prices WHERE plan=NEW.plan)
      AND NEW.final=MAX(0,NEW.original-IIF(d.kind='percent',CAST((NEW.original*d.amount+50)/100 AS INTEGER),d.amount))
      AND NEW.discount=NEW.original-NEW.final
  );
END;


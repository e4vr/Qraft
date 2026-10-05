-- Existing promotions remain unrestricted. A bound discount follows the
-- account UID, independently of its display name or email.
ALTER TABLE discount_codes ADD COLUMN bound_user_id TEXT;
CREATE INDEX idx_discount_codes_bound_user ON discount_codes(bound_user_id);

-- Re-check ownership inside the same transaction as manual confirmation.
-- The existing redeem_discount trigger still owns price and usage validation.
CREATE TRIGGER redeem_discount_account BEFORE INSERT ON subscription_events
WHEN NEW.action='discount_redeemed' AND NEW.status='success'
BEGIN
  SELECT RAISE(ABORT,'DISCOUNT_UNAVAILABLE') WHERE EXISTS(
    SELECT 1 FROM discount_codes d WHERE d.id=NEW.code_id
      AND d.bound_user_id IS NOT NULL AND d.bound_user_id<>NEW.user_id
  );
END;

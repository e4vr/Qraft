-- Additive ownership for result receipts; deleting a profile removes its receipts.
ALTER TABLE preformed_submission_receipts ADD COLUMN user_id text REFERENCES profiles(uid) ON DELETE CASCADE;
ALTER TABLE preformed_attempt_tokens ADD COLUMN submitted_at text;
UPDATE preformed_submission_receipts SET user_id = coalesce(
  (SELECT t.user_id FROM preformed_attempt_tokens t JOIN profiles p ON p.uid=t.user_id WHERE t.token_hash=attempt_token_hash),
  (SELECT participant_user_id FROM preformed_leaderboard WHERE id=submission_id)
);
UPDATE preformed_attempt_tokens SET submitted_at=(
  SELECT created_at FROM preformed_submission_receipts WHERE attempt_token_hash=token_hash
) WHERE EXISTS(SELECT 1 FROM preformed_submission_receipts WHERE attempt_token_hash=token_hash);
-- Remove residual identities whose accounts have already been deleted.
DELETE FROM preformed_attempt_tokens WHERE user_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM profiles WHERE uid=user_id);
DELETE FROM preformed_leaderboard WHERE guest=0 AND participant_key LIKE 'user:%'
  AND NOT EXISTS(SELECT 1 FROM profiles WHERE uid=substr(participant_key,6));
CREATE INDEX idx_preformed_receipts_user ON preformed_submission_receipts(user_id);
CREATE INDEX idx_preformed_attempt_tokens_user ON preformed_attempt_tokens(user_id);
CREATE INDEX idx_preformed_leaderboard_user ON preformed_leaderboard(participant_user_id);

-- Durable per-participant aggregates survive the short receipt retention window.
CREATE TABLE preformed_participant_question_stats (
  user_id text NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  test_id text NOT NULL REFERENCES preformed_tests(id) ON DELETE CASCADE,
  version integer NOT NULL,
  question_id text NOT NULL,
  submissions integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,test_id,version,question_id)
);

-- Repeated event-driven reads use these shapes. Keep the set small so writes
-- do not pay for indexes that are only useful to rare administration queries.
CREATE INDEX IF NOT EXISTS idx_records_type_owner_updated
  ON records(type, owner_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_records_pending_owner_updated
  ON records(owner_id, updated_at DESC)
  WHERE type='questionProposals' AND json_extract(payload,'$.status')='pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_records_membership_user_role
  ON records(json_extract(payload,'$.userId'), json_extract(payload,'$.role'), qbank_id)
  WHERE type='qbankMemberships';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_test_registry_user_started
  ON test_registry(user_id, started_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_imported_files_user_uploaded
  ON imported_files(user_id, uploaded_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contribution_reviews_author_created
  ON contribution_reviews(author_id, created_at DESC);
--> statement-breakpoint
PRAGMA optimize;

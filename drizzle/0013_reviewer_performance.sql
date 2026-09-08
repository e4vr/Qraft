CREATE TABLE review_completion_claims (
  proposal_id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Retain historical dates and only backfill actual recorded decisions.
INSERT OR IGNORE INTO contribution_reviews(id,proposal_id,author_id,reviewer_id,decision,high_risk,created_at,metadata)
SELECT 'historical-'||id,id,json_extract(payload,'$.proposedById'),json_extract(payload,'$.reviewedById'),
  json_extract(payload,'$.status'),0,json_extract(payload,'$.reviewedAt'),
  json_object('edited',json_extract(payload,'$.type')='question_edit')
FROM records WHERE type='questionProposals' AND json_extract(payload,'$.status') IN ('approved','rejected')
  AND json_extract(payload,'$.reviewedById') IS NOT NULL AND json_extract(payload,'$.proposedById') IS NOT NULL
  AND julianday(json_extract(payload,'$.reviewedAt')) IS NOT NULL;

INSERT OR IGNORE INTO review_completion_claims(proposal_id,reviewer_id,created_at)
SELECT id,json_extract(payload,'$.reviewedById'),coalesce(json_extract(payload,'$.reviewedAt'),updated_at)
FROM records WHERE type='questionProposals' AND json_extract(payload,'$.status') IN ('approved','rejected')
  AND json_extract(payload,'$.reviewedById') IS NOT NULL;

-- Cover legacy collaboration writes, as well as the current bulk-review API.
CREATE TRIGGER claim_review_completion BEFORE UPDATE OF payload ON records
WHEN NEW.type='questionProposals' AND json_extract(OLD.payload,'$.status')='pending'
  AND json_extract(NEW.payload,'$.status') IN ('approved','rejected')
BEGIN
  SELECT RAISE(ABORT,'REVIEW_ALREADY_COMPLETED') WHERE EXISTS (
    SELECT 1 FROM review_completion_claims WHERE proposal_id=NEW.id AND reviewer_id<>json_extract(NEW.payload,'$.reviewedById')
  );
  INSERT OR IGNORE INTO review_completion_claims VALUES(NEW.id,json_extract(NEW.payload,'$.reviewedById'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER capture_review_completion AFTER UPDATE OF payload ON records
WHEN NEW.type='questionProposals' AND json_extract(OLD.payload,'$.status')='pending'
  AND json_extract(NEW.payload,'$.status') IN ('approved','rejected')
BEGIN
  INSERT OR IGNORE INTO contribution_reviews(id,proposal_id,author_id,reviewer_id,decision,high_risk,created_at,metadata)
  VALUES('review-'||NEW.id||'-'||json_extract(NEW.payload,'$.reviewedById'),NEW.id,
    json_extract(NEW.payload,'$.proposedById'),json_extract(NEW.payload,'$.reviewedById'),json_extract(NEW.payload,'$.status'),0,
    strftime('%Y-%m-%dT%H:%M:%fZ','now'),json_object('edited',json_extract(NEW.payload,'$.type')='question_edit'));
END;

-- One range scan for the month across all reviewers.
CREATE INDEX idx_contribution_reviews_created_reviewer ON contribution_reviews(created_at,reviewer_id);

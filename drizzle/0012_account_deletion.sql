-- A checked snapshot guard makes the complete deletion batch abort if sharing
-- or attribution changed after it was read. No original identity is retained.
CREATE TABLE account_deletions (
  id TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL,
  snapshot_valid INTEGER NOT NULL CHECK(snapshot_valid=1)
);

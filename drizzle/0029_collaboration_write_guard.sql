-- A transaction-local assertion. The application deletes its row in the same
-- batch. A failed assertion rolls back all record writes and audit entries.
CREATE TABLE collaboration_write_guards (
  id TEXT PRIMARY KEY NOT NULL,
  valid INTEGER NOT NULL CONSTRAINT collaboration_snapshot_matches CHECK(valid=1)
);

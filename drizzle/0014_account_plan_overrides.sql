CREATE TABLE account_plan_overrides (
  user_id TEXT PRIMARY KEY REFERENCES profiles(uid) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('free','lite','pro','unlimited')),
  expires_at TEXT,
  reason TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

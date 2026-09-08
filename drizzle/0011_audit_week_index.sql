CREATE INDEX IF NOT EXISTS idx_records_type_updated_at
ON records(type, updated_at DESC);

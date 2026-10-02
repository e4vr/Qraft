CREATE TABLE import_question_keys (
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  qbank_id TEXT NOT NULL,
  stem_key TEXT NOT NULL,
  content_key TEXT,
  PRIMARY KEY(record_type,record_id)
);
CREATE INDEX idx_import_question_keys_stem ON import_question_keys(qbank_id,stem_key);
CREATE INDEX idx_import_question_keys_content ON import_question_keys(qbank_id,content_key);
CREATE TABLE import_search_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO import_search_state(id,revision) VALUES(1,0);
CREATE TABLE import_search_guards (
  id TEXT PRIMARY KEY NOT NULL,
  valid INTEGER NOT NULL CONSTRAINT import_search_snapshot_matches CHECK(valid=1)
);

-- SQL owns invalidation for EVERY writer. Missing keys use the unchanged FTS
-- fallback; stale keys can never be used to skip a question after an edit.
CREATE TRIGGER import_search_integrity_insert AFTER INSERT ON records
WHEN NEW.type IN ('sharedQuestions','questionProposals')
BEGIN
  DELETE FROM import_question_keys WHERE record_type=NEW.type AND record_id=NEW.id;
  UPDATE import_search_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER import_search_integrity_update AFTER UPDATE ON records
WHEN (OLD.type IN ('sharedQuestions','questionProposals') OR NEW.type IN ('sharedQuestions','questionProposals'))
  AND (NEW.payload IS NOT OLD.payload OR NEW.qbank_id IS NOT OLD.qbank_id OR NEW.type IS NOT OLD.type OR NEW.id IS NOT OLD.id)
BEGIN
  -- Classification/source/explanation-only edits do not change either key.
  -- Every identity/status/bank edit invalidates it before any future lookup.
  DELETE FROM import_question_keys
  WHERE ((record_type=OLD.type AND record_id=OLD.id) OR (record_type=NEW.type AND record_id=NEW.id))
    AND (NEW.type IS NOT OLD.type OR NEW.id IS NOT OLD.id OR NEW.qbank_id IS NOT OLD.qbank_id
      OR json_extract(NEW.payload,'$.status') IS NOT json_extract(OLD.payload,'$.status')
      OR json_extract(NEW.payload,'$.stem') IS NOT json_extract(OLD.payload,'$.stem')
      OR json_extract(NEW.payload,'$.options') IS NOT json_extract(OLD.payload,'$.options')
      OR json_extract(NEW.payload,'$.answer') IS NOT json_extract(OLD.payload,'$.answer')
      OR json_extract(NEW.payload,'$.payload.stem') IS NOT json_extract(OLD.payload,'$.payload.stem')
      OR json_extract(NEW.payload,'$.payload.options') IS NOT json_extract(OLD.payload,'$.payload.options')
      OR json_extract(NEW.payload,'$.payload.answer') IS NOT json_extract(OLD.payload,'$.payload.answer'));
  UPDATE import_search_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER import_search_integrity_delete AFTER DELETE ON records
WHEN OLD.type IN ('sharedQuestions','questionProposals')
BEGIN
  DELETE FROM import_question_keys WHERE record_type=OLD.type AND record_id=OLD.id;
  UPDATE import_search_state SET revision=revision+1 WHERE id=1;
END;

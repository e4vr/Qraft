-- Separate authoring revision from the content version that governs attempts.
ALTER TABLE preformed_tests ADD COLUMN edit_revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER enforce_preformed_edit_revision
BEFORE UPDATE OF edit_revision ON preformed_tests
WHEN NEW.edit_revision <> OLD.edit_revision + 1
BEGIN
  SELECT RAISE(ABORT, 'PREFORMED_EDIT_CONFLICT');
END;

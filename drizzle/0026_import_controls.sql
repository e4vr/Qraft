CREATE TABLE import_defaults (id INTEGER PRIMARY KEY CHECK(id=1), questions_per_import INTEGER CHECK(questions_per_import BETWEEN 1 AND 5000), imports_per_day INTEGER CHECK(imports_per_day BETWEEN 1 AND 100));
INSERT INTO import_defaults VALUES(1,NULL,NULL);
CREATE TABLE import_policies (
 user_id TEXT PRIMARY KEY REFERENCES profiles(uid) ON DELETE CASCADE,
 questions_per_import INTEGER NOT NULL CHECK(questions_per_import BETWEEN 1 AND 5000),
 imports_per_day INTEGER NOT NULL CHECK(imports_per_day BETWEEN 1 AND 100),
 updated_at TEXT NOT NULL
);
ALTER TABLE imported_files ADD COLUMN run_id TEXT;
ALTER TABLE imported_files ADD COLUMN question_limit INTEGER NOT NULL DEFAULT 1000000;
CREATE INDEX idx_imported_files_user_run ON imported_files(user_id,run_id,uploaded_at);
DROP TRIGGER enforce_json_import_limits;
CREATE TRIGGER enforce_json_import_limits BEFORE INSERT ON imported_files
BEGIN
 SELECT RAISE(ABORT,'JSON_IMPORT_DAILY_LIMIT') WHERE
 NOT EXISTS(SELECT 1 FROM imported_files WHERE user_id=NEW.user_id AND run_id=NEW.run_id)
 AND (SELECT count(DISTINCT coalesce(run_id,id)) FROM imported_files WHERE user_id=NEW.user_id AND substr(uploaded_at,1,10)=substr(NEW.uploaded_at,1,10))>=NEW.daily_limit;
 SELECT RAISE(ABORT,'JSON_IMPORT_QUESTION_LIMIT') WHERE
 coalesce((SELECT sum(successful_count) FROM imported_files WHERE user_id=NEW.user_id AND run_id=NEW.run_id),0)+NEW.successful_count>NEW.question_limit;
 SELECT RAISE(ABORT,'JSON_IMPORT_PENDING_LIMIT') WHERE
 (SELECT count(*) FROM records WHERE type='questionProposals' AND owner_id=NEW.user_id AND json_extract(payload,'$.status')='pending')+NEW.successful_count>NEW.pending_limit;
END;
-- Keep historical duplicate attempts and existing suspensions. New imports use
-- explicit duplicate review, while an existing suspension remains in force
-- until its original expiry or an administrator removes it.
-- Indexed bank and stem search; only searchable question text is duplicated in D1.
CREATE VIRTUAL TABLE import_question_search USING fts5(stem,bank,entity_id UNINDEXED,entity_type UNINDEXED);
INSERT INTO import_question_search(rowid,stem,bank,entity_id,entity_type)
SELECT rowid,coalesce(json_extract(payload,'$.payload.stem'),json_extract(payload,'$.stem')),qbank_id,id,type FROM records WHERE type IN ('sharedQuestions','questionProposals') AND (type='sharedQuestions' OR json_extract(payload,'$.status')='pending');
CREATE TRIGGER import_question_search_insert AFTER INSERT ON records WHEN NEW.type IN ('sharedQuestions','questionProposals') AND (NEW.type='sharedQuestions' OR json_extract(NEW.payload,'$.status')='pending')
BEGIN
 INSERT INTO import_question_search(rowid,stem,bank,entity_id,entity_type) VALUES(NEW.rowid,coalesce(json_extract(NEW.payload,'$.payload.stem'),json_extract(NEW.payload,'$.stem')),NEW.qbank_id,NEW.id,NEW.type);
END;
CREATE TRIGGER import_question_search_update AFTER UPDATE ON records WHEN NEW.type IN ('sharedQuestions','questionProposals')
BEGIN
 DELETE FROM import_question_search WHERE rowid=OLD.rowid;
 INSERT INTO import_question_search(rowid,stem,bank,entity_id,entity_type) SELECT NEW.rowid,coalesce(json_extract(NEW.payload,'$.payload.stem'),json_extract(NEW.payload,'$.stem')),NEW.qbank_id,NEW.id,NEW.type WHERE NEW.type='sharedQuestions' OR json_extract(NEW.payload,'$.status')='pending';
END;
CREATE TRIGGER import_question_search_delete AFTER DELETE ON records WHEN OLD.type IN ('sharedQuestions','questionProposals')
BEGIN
 DELETE FROM import_question_search WHERE rowid=OLD.rowid;
END;

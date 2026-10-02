-- The journal is part of the same transaction as the record mutation, including
-- cascades, restores and administrative writers. WebSockets remain hints only.
CREATE TABLE collaboration_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  qbank_id TEXT,
  owner_id TEXT,
  reset_required INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER collaboration_change_insert AFTER INSERT ON records
WHEN NEW.type IN ('qbanks','qbankTombstones','qbankFolders','qbankMemberships','qbankInvitations','universityIds','adminInvites','questionProposals','roleApplications','sharedQuestions','qbankSpecialties','qbankTopics','answerStats','sharedNotes','system')
BEGIN
  INSERT INTO collaboration_changes(collection,record_id,qbank_id,owner_id)
  VALUES(NEW.type,NEW.id,coalesce(NEW.qbank_id,json_extract(NEW.payload,'$.qbankId')),coalesce(NEW.owner_id,json_extract(NEW.payload,'$.proposedById')));
END;

CREATE TRIGGER collaboration_change_update AFTER UPDATE ON records
WHEN (NEW.type IN ('qbanks','qbankTombstones','qbankFolders','qbankMemberships','qbankInvitations','universityIds','adminInvites','questionProposals','roleApplications','sharedQuestions','qbankSpecialties','qbankTopics','answerStats','sharedNotes','system')
  OR OLD.type IN ('qbanks','qbankTombstones','qbankFolders','qbankMemberships','qbankInvitations','universityIds','adminInvites','questionProposals','roleApplications','sharedQuestions','qbankSpecialties','qbankTopics','answerStats','sharedNotes','system'))
  AND (NEW.payload IS NOT OLD.payload OR NEW.qbank_id IS NOT OLD.qbank_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.type IS NOT OLD.type OR NEW.id IS NOT OLD.id)
BEGIN
  INSERT INTO collaboration_changes(collection,record_id,qbank_id,owner_id,reset_required)
  VALUES(NEW.type,NEW.id,coalesce(NEW.qbank_id,json_extract(NEW.payload,'$.qbankId')),coalesce(NEW.owner_id,json_extract(NEW.payload,'$.proposedById')),
    coalesce(NEW.qbank_id,json_extract(NEW.payload,'$.qbankId')) IS NOT coalesce(OLD.qbank_id,json_extract(OLD.payload,'$.qbankId')) OR
    coalesce(NEW.owner_id,json_extract(NEW.payload,'$.proposedById')) IS NOT coalesce(OLD.owner_id,json_extract(OLD.payload,'$.proposedById')) OR NEW.type IS NOT OLD.type OR NEW.id IS NOT OLD.id);
END;

CREATE TRIGGER collaboration_change_delete AFTER DELETE ON records
WHEN OLD.type IN ('qbanks','qbankTombstones','qbankFolders','qbankMemberships','qbankInvitations','universityIds','adminInvites','questionProposals','roleApplications','sharedQuestions','qbankSpecialties','qbankTopics','answerStats','sharedNotes','system')
BEGIN
  INSERT INTO collaboration_changes(collection,record_id,qbank_id,owner_id)
  VALUES(OLD.type,OLD.id,coalesce(OLD.qbank_id,json_extract(OLD.payload,'$.qbankId')),coalesce(OLD.owner_id,json_extract(OLD.payload,'$.proposedById')));
END;

CREATE TRIGGER collaboration_profile_insert AFTER INSERT ON profiles
BEGIN
  INSERT INTO collaboration_changes(collection,record_id) VALUES('profiles',NEW.uid);
END;
CREATE TRIGGER collaboration_profile_update AFTER UPDATE OF profile_json ON profiles
WHEN NEW.profile_json IS NOT OLD.profile_json
BEGIN
  INSERT INTO collaboration_changes(collection,record_id) VALUES('profiles',NEW.uid);
END;
CREATE TRIGGER collaboration_profile_delete AFTER DELETE ON profiles
BEGIN
  INSERT INTO collaboration_changes(collection,record_id) VALUES('profiles',OLD.uid);
END;

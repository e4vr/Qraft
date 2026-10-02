-- A bank deletion fires question_identity_delete once per shared question.
-- Index its JSON references so every trigger finds only related records.
CREATE INDEX idx_records_type_question_reference
ON records(type,json_extract(payload,'$.questionId'))
WHERE json_extract(payload,'$.questionId') IS NOT NULL;

CREATE INDEX idx_records_audit_entity_reference
ON records(json_extract(payload,'$.entityId'))
WHERE type='auditLog';

CREATE INDEX idx_records_share_link_bank
ON records(json_extract(payload,'$.qbankId'))
WHERE type='qbankShareLinks';

CREATE INDEX idx_question_ids_qbank ON question_ids(qbank_id);

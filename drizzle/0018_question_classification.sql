CREATE TABLE `qbank_classification_revisions` (
  `qbank_id` text PRIMARY KEY NOT NULL,
  `revision` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL
);

CREATE TABLE `classification_operations` (
  `operation_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `profiles`(`uid`) ON DELETE CASCADE,
  `qbank_id` text NOT NULL,
  `revision` integer NOT NULL,
  `created_at` text NOT NULL
);

CREATE INDEX `idx_classification_operations_created`
ON `classification_operations` (`created_at`);

WITH classification AS (
  SELECT DISTINCT
    coalesce(qbank_id, 'smle-gs') AS qbank_id,
    coalesce(json_extract(payload, '$.specialty'), 'General') AS specialty,
    updated_at
  FROM records
  WHERE type = 'sharedQuestions'
  UNION
  SELECT DISTINCT
    coalesce(qbank_id, 'smle-gs'),
    coalesce(json_extract(payload, '$.payload.specialty'), 'General'),
    updated_at
  FROM records
  WHERE type = 'questionProposals' AND json_extract(payload, '$.status') = 'pending'
)
INSERT OR IGNORE INTO records(type, id, qbank_id, payload, updated_at)
SELECT
  'qbankSpecialties',
  'legacy-specialty-' || lower(hex(CAST(qbank_id || char(31) || specialty AS BLOB))),
  qbank_id,
  json_object(
    'id', 'legacy-specialty-' || lower(hex(CAST(qbank_id || char(31) || specialty AS BLOB))),
    'qbankId', qbank_id,
    'name', specialty,
    'order', 0,
    'createdAt', min(updated_at),
    'updatedAt', max(updated_at)
  ),
  max(updated_at)
FROM classification
GROUP BY qbank_id, specialty;

WITH classification AS (
  SELECT DISTINCT
    coalesce(qbank_id, 'smle-gs') AS qbank_id,
    coalesce(json_extract(payload, '$.specialty'), 'General') AS specialty,
    coalesce(json_extract(payload, '$.topic'), 'General') AS topic,
    updated_at
  FROM records
  WHERE type = 'sharedQuestions'
  UNION
  SELECT DISTINCT
    coalesce(qbank_id, 'smle-gs'),
    coalesce(json_extract(payload, '$.payload.specialty'), 'General'),
    coalesce(json_extract(payload, '$.payload.topic'), 'General'),
    updated_at
  FROM records
  WHERE type = 'questionProposals' AND json_extract(payload, '$.status') = 'pending'
)
INSERT OR IGNORE INTO records(type, id, qbank_id, payload, updated_at)
SELECT
  'qbankTopics',
  'legacy-topic-' || lower(hex(CAST(qbank_id || char(31) || specialty || char(31) || topic AS BLOB))),
  qbank_id,
  json_object(
    'id', 'legacy-topic-' || lower(hex(CAST(qbank_id || char(31) || specialty || char(31) || topic AS BLOB))),
    'qbankId', qbank_id,
    'specialtyId', 'legacy-specialty-' || lower(hex(CAST(qbank_id || char(31) || specialty AS BLOB))),
    'name', topic,
    'order', 0,
    'createdAt', min(updated_at),
    'updatedAt', max(updated_at)
  ),
  max(updated_at)
FROM classification
GROUP BY qbank_id, specialty, topic;

UPDATE records
SET payload = json_set(
  payload,
  '$.specialtyId', 'legacy-specialty-' || lower(hex(CAST(coalesce(qbank_id, 'smle-gs') || char(31) || coalesce(json_extract(payload, '$.specialty'), 'General') AS BLOB))),
  '$.topicId', 'legacy-topic-' || lower(hex(CAST(coalesce(qbank_id, 'smle-gs') || char(31) || coalesce(json_extract(payload, '$.specialty'), 'General') || char(31) || coalesce(json_extract(payload, '$.topic'), 'General') AS BLOB)))
)
WHERE type = 'sharedQuestions';

UPDATE records
SET payload = json_set(
  payload,
  '$.payload.specialtyId', 'legacy-specialty-' || lower(hex(CAST(coalesce(qbank_id, 'smle-gs') || char(31) || coalesce(json_extract(payload, '$.payload.specialty'), 'General') AS BLOB))),
  '$.payload.topicId', 'legacy-topic-' || lower(hex(CAST(coalesce(qbank_id, 'smle-gs') || char(31) || coalesce(json_extract(payload, '$.payload.specialty'), 'General') || char(31) || coalesce(json_extract(payload, '$.payload.topic'), 'General') AS BLOB)))
)
WHERE type = 'questionProposals' AND json_extract(payload, '$.status') = 'pending';

INSERT OR IGNORE INTO qbank_classification_revisions(qbank_id, revision, updated_at)
SELECT DISTINCT coalesce(qbank_id, 'smle-gs'), 0, datetime('now')
FROM records
WHERE type IN ('qbanks', 'sharedQuestions');

CREATE TRIGGER `enforce_qbank_classification_revision`
BEFORE UPDATE ON `qbank_classification_revisions`
WHEN NEW.revision != OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'CLASSIFICATION_CONFLICT');
END;

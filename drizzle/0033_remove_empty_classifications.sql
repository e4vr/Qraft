-- Remove legacy empty classifications once; proposals retain their IDs/names.
-- Ordinary content writers maintain this invariant in their atomic D1 batches.
WITH questions AS (
  SELECT id, qbank_id,
    json_extract(payload,'$.topicId') topic_id,
    json_extract(payload,'$.specialtyId') specialty_id,
    json_extract(payload,'$.topic') topic_name,
    json_extract(payload,'$.specialty') specialty_name
  FROM records WHERE type='sharedQuestions'
), occupied AS (
  SELECT coalesce(assigned_topic.id,named_topic.id) topic_id,
    coalesce(assigned_specialty.id,named_specialty.id) specialty_id
  FROM questions q
  LEFT JOIN records assigned_topic ON assigned_topic.type='qbankTopics'
    AND assigned_topic.qbank_id=q.qbank_id AND assigned_topic.id=q.topic_id
  LEFT JOIN records assigned_specialty ON assigned_specialty.type='qbankSpecialties'
    AND assigned_specialty.qbank_id=q.qbank_id
    AND assigned_specialty.id=coalesce(json_extract(assigned_topic.payload,'$.specialtyId'),q.specialty_id)
  LEFT JOIN records named_specialty ON assigned_specialty.id IS NULL
    AND named_specialty.type='qbankSpecialties' AND named_specialty.qbank_id=q.qbank_id
    AND lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(json_extract(named_specialty.payload,'$.name'),char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))=lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(q.specialty_name,char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))
  LEFT JOIN records named_topic ON assigned_topic.id IS NULL
    AND named_topic.type='qbankTopics' AND named_topic.qbank_id=q.qbank_id
    AND json_extract(named_topic.payload,'$.specialtyId')=coalesce(assigned_specialty.id,named_specialty.id)
    AND lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(json_extract(named_topic.payload,'$.name'),char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))=lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(q.topic_name,char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))
)
        INSERT INTO qbank_classification_revisions(qbank_id,revision,updated_at)
SELECT DISTINCT qbank_id,1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM records
WHERE qbank_id IS NOT NULL AND ((type='qbankTopics' AND id NOT IN (SELECT topic_id FROM occupied WHERE topic_id IS NOT NULL)) OR (type='qbankSpecialties' AND id NOT IN (SELECT specialty_id FROM occupied WHERE specialty_id IS NOT NULL)))
ON CONFLICT(qbank_id) DO UPDATE SET revision=qbank_classification_revisions.revision+1,updated_at=excluded.updated_at;

WITH questions AS (
  SELECT id, qbank_id,
    json_extract(payload,'$.topicId') topic_id,
    json_extract(payload,'$.specialtyId') specialty_id,
    json_extract(payload,'$.topic') topic_name,
    json_extract(payload,'$.specialty') specialty_name
  FROM records WHERE type='sharedQuestions'
), occupied AS (
  SELECT coalesce(assigned_topic.id,named_topic.id) topic_id,
    coalesce(assigned_specialty.id,named_specialty.id) specialty_id
  FROM questions q
  LEFT JOIN records assigned_topic ON assigned_topic.type='qbankTopics'
    AND assigned_topic.qbank_id=q.qbank_id AND assigned_topic.id=q.topic_id
  LEFT JOIN records assigned_specialty ON assigned_specialty.type='qbankSpecialties'
    AND assigned_specialty.qbank_id=q.qbank_id
    AND assigned_specialty.id=coalesce(json_extract(assigned_topic.payload,'$.specialtyId'),q.specialty_id)
  LEFT JOIN records named_specialty ON assigned_specialty.id IS NULL
    AND named_specialty.type='qbankSpecialties' AND named_specialty.qbank_id=q.qbank_id
    AND lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(json_extract(named_specialty.payload,'$.name'),char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))=lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(q.specialty_name,char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))
  LEFT JOIN records named_topic ON assigned_topic.id IS NULL
    AND named_topic.type='qbankTopics' AND named_topic.qbank_id=q.qbank_id
    AND json_extract(named_topic.payload,'$.specialtyId')=coalesce(assigned_specialty.id,named_specialty.id)
    AND lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(json_extract(named_topic.payload,'$.name'),char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))=lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(q.topic_name,char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))
)
        DELETE FROM records WHERE type='qbankTopics' AND id NOT IN (SELECT topic_id FROM occupied WHERE topic_id IS NOT NULL);

WITH questions AS (
  SELECT id, qbank_id,
    json_extract(payload,'$.topicId') topic_id,
    json_extract(payload,'$.specialtyId') specialty_id,
    json_extract(payload,'$.topic') topic_name,
    json_extract(payload,'$.specialty') specialty_name
  FROM records WHERE type='sharedQuestions'
), occupied AS (
  SELECT coalesce(assigned_topic.id,named_topic.id) topic_id,
    coalesce(assigned_specialty.id,named_specialty.id) specialty_id
  FROM questions q
  LEFT JOIN records assigned_topic ON assigned_topic.type='qbankTopics'
    AND assigned_topic.qbank_id=q.qbank_id AND assigned_topic.id=q.topic_id
  LEFT JOIN records assigned_specialty ON assigned_specialty.type='qbankSpecialties'
    AND assigned_specialty.qbank_id=q.qbank_id
    AND assigned_specialty.id=coalesce(json_extract(assigned_topic.payload,'$.specialtyId'),q.specialty_id)
  LEFT JOIN records named_specialty ON assigned_specialty.id IS NULL
    AND named_specialty.type='qbankSpecialties' AND named_specialty.qbank_id=q.qbank_id
    AND lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(json_extract(named_specialty.payload,'$.name'),char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))=lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(q.specialty_name,char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))
  LEFT JOIN records named_topic ON assigned_topic.id IS NULL
    AND named_topic.type='qbankTopics' AND named_topic.qbank_id=q.qbank_id
    AND json_extract(named_topic.payload,'$.specialtyId')=coalesce(assigned_specialty.id,named_specialty.id)
    AND lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(json_extract(named_topic.payload,'$.name'),char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))=lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(q.topic_name,char(9),' '),char(10),' '),char(13),' '),char(160),' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')))
)
        DELETE FROM records WHERE type='qbankSpecialties' AND id NOT IN (SELECT specialty_id FROM occupied WHERE specialty_id IS NOT NULL);

-- Read-only Phase 2 integrity checks. Every result row represents a condition to investigate.

-- check: foreign-key violations
PRAGMA foreign_key_check;

-- check: generic records whose QBank no longer exists
SELECT type, id, qbank_id
FROM records
WHERE qbank_id IS NOT NULL
  AND qbank_id <> 'smle-gs'
  AND NOT EXISTS (
    SELECT 1 FROM records bank
    WHERE bank.type = 'qbanks' AND bank.id = records.qbank_id
  );

-- check: memberships whose account no longer exists
SELECT id, qbank_id, json_extract(payload, '$.userId') AS user_id
FROM records
WHERE type = 'qbankMemberships'
  AND NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE uid = json_extract(records.payload, '$.userId')
  );

-- check: duplicate memberships for the same account and QBank
SELECT qbank_id, json_extract(payload, '$.userId') AS user_id, count(*) AS duplicates
FROM records
WHERE type = 'qbankMemberships'
GROUP BY qbank_id, json_extract(payload, '$.userId')
HAVING count(*) > 1;

-- check: shared questions without matching identity rows
SELECT records.id, json_extract(records.payload, '$.questionId') AS question_id
FROM records
LEFT JOIN question_registry ON question_registry.id = records.id
WHERE records.type = 'sharedQuestions' AND question_registry.id IS NULL;

-- check: identity rows without matching shared questions
SELECT question_registry.id, question_registry.question_id
FROM question_registry
LEFT JOIN records
  ON records.type = 'sharedQuestions' AND records.id = question_registry.id
WHERE records.id IS NULL;

-- check: duplicate display Question IDs
SELECT json_extract(payload, '$.questionId') AS question_id, count(*) AS duplicates
FROM records
WHERE type = 'sharedQuestions'
GROUP BY json_extract(payload, '$.questionId')
HAVING count(*) > 1;

-- check: topics whose specialty is missing or belongs to a different QBank
SELECT topic.id, topic.qbank_id, json_extract(topic.payload, '$.specialtyId') AS specialty_id
FROM records topic
LEFT JOIN records specialty
  ON specialty.type = 'qbankSpecialties'
 AND specialty.id = json_extract(topic.payload, '$.specialtyId')
WHERE topic.type = 'qbankTopics'
  AND (specialty.id IS NULL OR specialty.qbank_id <> topic.qbank_id);

-- check: negative infrastructure/accounting counters
SELECT 'counters' AS source, id, value
FROM counters
WHERE value < 0
UNION ALL
SELECT 'r2_usage_periods', period_start,
       min(class_a_operations, class_b_operations)
FROM r2_usage_periods
WHERE class_a_operations < 0 OR class_b_operations < 0;

-- check: impossible subscription status/date combinations
SELECT user_id, status, starts_at, expires_at
FROM subscriptions
WHERE status NOT IN ('active', 'manually_activated', 'expired', 'cancelled')
   OR (
     status <> 'cancelled'
     AND starts_at IS NOT NULL
     AND expires_at IS NOT NULL
     AND starts_at >= expires_at
   );

-- check: expired subscriptions that still need the scheduled status transition
SELECT user_id, status, expires_at
FROM subscriptions
WHERE status IN ('active', 'manually_activated')
  AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- check: review completions referencing absent proposals
SELECT review_completion_claims.proposal_id, review_completion_claims.reviewer_id
FROM review_completion_claims
LEFT JOIN records
  ON records.type = 'questionProposals'
 AND records.id = review_completion_claims.proposal_id
WHERE records.id IS NULL;

-- check: preformed submissions without their test (defensive; FKs should prevent this)
SELECT preformed_submission_receipts.submission_id,
       preformed_submission_receipts.test_id
FROM preformed_submission_receipts
LEFT JOIN preformed_tests
  ON preformed_tests.id = preformed_submission_receipts.test_id
WHERE preformed_tests.id IS NULL;

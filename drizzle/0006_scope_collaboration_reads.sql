-- Keep legacy collaboration rows scoped to their QBank so normal user loads
-- do not scan every question in the database.
UPDATE records
SET qbank_id = CASE
  WHEN json_valid(payload) AND json_extract(payload, '$.qbankId') IS NOT NULL
    THEN json_extract(payload, '$.qbankId')
  ELSE 'smle-gs'
END
WHERE qbank_id IS NULL
  AND type IN (
    'qbankMemberships',
    'qbankInvitations',
    'questionProposals',
    'sharedQuestions',
    'answerStats',
    'sharedNotes'
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_records_qbank_type`
  ON `records` (`qbank_id`, `type`);

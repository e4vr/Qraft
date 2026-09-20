ALTER TABLE `preformed_submission_receipts`
ADD COLUMN `attempt_token_hash` text;

CREATE UNIQUE INDEX `idx_preformed_submission_receipts_attempt_token`
ON `preformed_submission_receipts` (`attempt_token_hash`);

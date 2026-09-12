CREATE TABLE `preformed_tests` (
  `id` text PRIMARY KEY NOT NULL,
  `code` text NOT NULL UNIQUE,
  `owner_id` text NOT NULL REFERENCES `profiles`(`uid`) ON DELETE CASCADE,
  `owner_name` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `visibility` text NOT NULL DEFAULT 'private' CHECK (`visibility` IN ('public','private')),
  `status` text NOT NULL DEFAULT 'draft' CHECK (`status` IN ('draft','published','paused','hidden')),
  `version` integer NOT NULL DEFAULT 1,
  `questions_json` text NOT NULL DEFAULT '[]',
  `settings_json` text NOT NULL DEFAULT '{}',
  `passcode_hash` text,
  `passcode_salt` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX `idx_preformed_tests_code` ON `preformed_tests` (`code`);
CREATE INDEX `idx_preformed_tests_owner_updated` ON `preformed_tests` (`owner_id`,`updated_at`);
CREATE INDEX `idx_preformed_tests_public_updated` ON `preformed_tests` (`visibility`,`status`,`updated_at`);

CREATE TABLE `preformed_leaderboard` (
  `id` text PRIMARY KEY NOT NULL,
  `test_id` text NOT NULL REFERENCES `preformed_tests`(`id`) ON DELETE CASCADE,
  `version` integer NOT NULL,
  `participant_user_id` text REFERENCES `profiles`(`uid`) ON DELETE SET NULL,
  `participant_key` text NOT NULL,
  `participant_name` text NOT NULL,
  `guest` integer NOT NULL DEFAULT 0,
  `score` integer NOT NULL,
  `question_count` integer NOT NULL,
  `duration_seconds` integer NOT NULL,
  `attempt_number` integer NOT NULL,
  `submitted_at` text NOT NULL
);
CREATE INDEX `idx_preformed_leaderboard_rank` ON `preformed_leaderboard` (`test_id`,`version`,`score` DESC,`duration_seconds`,`submitted_at`);
CREATE INDEX `idx_preformed_leaderboard_participant` ON `preformed_leaderboard` (`test_id`,`version`,`participant_key`);

CREATE TABLE `preformed_question_stats` (
  `test_id` text NOT NULL REFERENCES `preformed_tests`(`id`) ON DELETE CASCADE,
  `version` integer NOT NULL,
  `question_id` text NOT NULL,
  `submissions` integer NOT NULL DEFAULT 0,
  `correct` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`test_id`,`version`,`question_id`)
);

CREATE TABLE `preformed_participation` (
  `test_id` text NOT NULL REFERENCES `preformed_tests`(`id`) ON DELETE CASCADE,
  `version` integer NOT NULL,
  `user_id` text NOT NULL REFERENCES `profiles`(`uid`) ON DELETE CASCADE,
  `attempts` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`test_id`,`version`,`user_id`)
);

CREATE TABLE `preformed_attempt_tokens` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `test_id` text NOT NULL REFERENCES `preformed_tests`(`id`) ON DELETE CASCADE,
  `version` integer NOT NULL,
  `user_id` text,
  `issued_at` text NOT NULL,
  `expires_at` text NOT NULL
);
CREATE INDEX `idx_preformed_attempt_tokens_expiry` ON `preformed_attempt_tokens` (`expires_at`);

CREATE TABLE `preformed_submission_receipts` (
  `submission_id` text PRIMARY KEY NOT NULL,
  `test_id` text NOT NULL REFERENCES `preformed_tests`(`id`) ON DELETE CASCADE,
  `leaderboard` integer NOT NULL DEFAULT 0,
  `result_json` text,
  `created_at` text NOT NULL
);
CREATE INDEX `idx_preformed_submission_receipts_created` ON `preformed_submission_receipts` (`created_at`);

CREATE TABLE `preformed_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `test_id` text NOT NULL REFERENCES `preformed_tests`(`id`) ON DELETE CASCADE,
  `reporter_id` text NOT NULL REFERENCES `profiles`(`uid`) ON DELETE CASCADE,
  `reason` text NOT NULL,
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `idx_preformed_reports_user_test` ON `preformed_reports` (`reporter_id`,`test_id`);
CREATE INDEX `idx_preformed_reports_test` ON `preformed_reports` (`test_id`,`created_at`);

CREATE TRIGGER `enforce_preformed_attempt_limit`
BEFORE INSERT ON `preformed_participation`
WHEN (SELECT json_extract(settings_json,'$.maxAttempts') FROM preformed_tests WHERE id=NEW.test_id) IS NOT NULL
  AND NEW.attempts > (SELECT json_extract(settings_json,'$.maxAttempts') FROM preformed_tests WHERE id=NEW.test_id)
BEGIN
  SELECT RAISE(ABORT, 'PREFORMED_ATTEMPT_LIMIT');
END;

CREATE TRIGGER `enforce_preformed_attempt_limit_update`
BEFORE UPDATE OF attempts ON `preformed_participation`
WHEN (SELECT json_extract(settings_json,'$.maxAttempts') FROM preformed_tests WHERE id=NEW.test_id) IS NOT NULL
  AND NEW.attempts > (SELECT json_extract(settings_json,'$.maxAttempts') FROM preformed_tests WHERE id=NEW.test_id)
BEGIN
  SELECT RAISE(ABORT, 'PREFORMED_ATTEMPT_LIMIT');
END;

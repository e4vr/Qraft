-- Additive-only foundation for provider-independent assets, idempotent sync,
-- aggregate dashboard reads, and future delta synchronization.
ALTER TABLE `media` ADD `provider` text NOT NULL DEFAULT 'imagekit';
--> statement-breakpoint
ALTER TABLE `media` ADD `storage_key` text;
--> statement-breakpoint
ALTER TABLE `media` ADD `file_hash` text;
--> statement-breakpoint
ALTER TABLE `media` ADD `original_name` text;
--> statement-breakpoint
ALTER TABLE `media` ADD `purpose` text NOT NULL DEFAULT 'question';
--> statement-breakpoint
ALTER TABLE `media` ADD `status` text NOT NULL DEFAULT 'ready';
--> statement-breakpoint
ALTER TABLE `media` ADD `expires_at` text;
--> statement-breakpoint
ALTER TABLE `media` ADD `updated_at` text;
--> statement-breakpoint
UPDATE `media` SET `storage_key`=`key`, `updated_at`=`created_at` WHERE `storage_key` IS NULL;
--> statement-breakpoint
INSERT INTO `counters` (`id`,`value`,`updated_at`)
SELECT 'media-bytes', COALESCE(SUM(`size`),0), datetime('now') FROM `media`
WHERE 1
ON CONFLICT(`id`) DO UPDATE SET `value`=excluded.`value`,`updated_at`=excluded.`updated_at`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_qbank_created` ON `media` (`qbank_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_owner_hash` ON `media` (`owner_id`,`file_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_expiry` ON `media` (`status`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `sync_operations` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `scope` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `profiles`(`uid`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_operations_user_created` ON `sync_operations` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `user_stats` (
  `user_id` text PRIMARY KEY NOT NULL,
  `questions_answered` integer NOT NULL DEFAULT 0,
  `correct_answers` integer NOT NULL DEFAULT 0,
  `incorrect_answers` integer NOT NULL DEFAULT 0,
  `exams_completed` integer NOT NULL DEFAULT 0,
  `flashcards_reviewed` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `profiles`(`uid`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_topic_stats` (
  `user_id` text NOT NULL,
  `qbank_id` text NOT NULL,
  `topic_id` text NOT NULL,
  `answered` integer NOT NULL DEFAULT 0,
  `correct` integer NOT NULL DEFAULT 0,
  `incorrect` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`user_id`,`qbank_id`,`topic_id`),
  FOREIGN KEY (`user_id`) REFERENCES `profiles`(`uid`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_topic_stats_dashboard` ON `user_topic_stats` (`user_id`,`qbank_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `qbank_stats` (
  `qbank_id` text PRIMARY KEY NOT NULL,
  `total_questions` integer NOT NULL DEFAULT 0,
  `pending_questions` integer NOT NULL DEFAULT 0,
  `approved_questions` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_changes` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `operation` text NOT NULL,
  `version` integer NOT NULL DEFAULT 1,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `profiles`(`uid`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_changes_user_sequence` ON `sync_changes` (`user_id`,`sequence`);

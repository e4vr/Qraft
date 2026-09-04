CREATE TABLE `app_states` (
	`user_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`uid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`id` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media` (
	`key` text PRIMARY KEY NOT NULL,
	`qbank_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`uid` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`profile_json` text NOT NULL,
	`totp_secret` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_profiles_email` ON `profiles` (`email`);--> statement-breakpoint
CREATE TABLE `question_ids` (
	`question_id` text PRIMARY KEY NOT NULL,
	`qbank_id` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`type` text NOT NULL,
	`id` text NOT NULL,
	`qbank_id` text,
	`owner_id` text,
	`email` text,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_records_type_id` ON `records` (`type`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_records_type_email` ON `records` (`type`,`email`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`uid`) ON UPDATE no action ON DELETE cascade
);

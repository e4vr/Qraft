CREATE TABLE `imported_files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`batch_id` text NOT NULL,
	`source_file` text NOT NULL,
	`successful_count` integer NOT NULL,
	`skipped_count` integer NOT NULL,
	`report_json` text NOT NULL,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`uid`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `idx_imported_files_user_name` ON `imported_files` (`user_id`,`normalized_name`);
CREATE UNIQUE INDEX `idx_imported_files_user_hash` ON `imported_files` (`user_id`,`file_hash`);
CREATE UNIQUE INDEX `idx_imported_files_batch` ON `imported_files` (`batch_id`);

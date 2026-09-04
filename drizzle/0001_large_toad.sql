DROP INDEX `idx_records_type_email`;--> statement-breakpoint
CREATE INDEX `idx_records_type_email` ON `records` (`type`,`email`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `verified` integer DEFAULT false NOT NULL;
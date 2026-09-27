-- File history is evidence, not an import lock. Repeat these drops defensively
-- so environments that missed 0022 cannot keep rejecting a recreated QBank.
DROP INDEX IF EXISTS idx_imported_files_user_name;
DROP INDEX IF EXISTS idx_imported_files_user_hash;

CREATE TABLE `json_import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`qbank_id` text NOT NULL,
	`file_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`source_file` text NOT NULL DEFAULT '',
	`status` text NOT NULL DEFAULT 'processing',
	`chunk_count` integer NOT NULL DEFAULT 1,
	`completed_chunks` integer NOT NULL DEFAULT 0,
	`total_count` integer NOT NULL DEFAULT 0,
	`successful_count` integer NOT NULL DEFAULT 0,
	`invalid_count` integer NOT NULL DEFAULT 0,
	`skipped_duplicate_count` integer NOT NULL DEFAULT 0,
	`flagged_duplicate_count` integer NOT NULL DEFAULT 0,
	`repaired` integer NOT NULL DEFAULT 0,
	`error_code` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`deleted_at` text,
	`deleted_by` text,
	`legacy` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`uid`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_json_import_runs_started` ON `json_import_runs` (`started_at`);
CREATE INDEX `idx_json_import_runs_status_started` ON `json_import_runs` (`status`,`started_at`);
CREATE INDEX `idx_json_import_runs_user_started` ON `json_import_runs` (`user_id`,`started_at`);
CREATE INDEX `idx_json_import_runs_qbank_started` ON `json_import_runs` (`qbank_id`,`started_at`);
CREATE INDEX `idx_json_import_runs_hash` ON `json_import_runs` (`file_hash`,`started_at`);

CREATE TABLE `json_import_attempts` (
	`request_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text NOT NULL,
	`chunk_index` integer NOT NULL DEFAULT 0,
	`chunk_hash` text NOT NULL,
	`status` text NOT NULL,
	`total_count` integer NOT NULL DEFAULT 0,
	`successful_count` integer NOT NULL DEFAULT 0,
	`invalid_count` integer NOT NULL DEFAULT 0,
	`skipped_duplicate_count` integer NOT NULL DEFAULT 0,
	`flagged_duplicate_count` integer NOT NULL DEFAULT 0,
	`report_json` text NOT NULL DEFAULT '[]',
	`error_code` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `json_import_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`uid`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_json_import_attempts_run_chunk` ON `json_import_attempts` (`run_id`,`chunk_index`);
CREATE INDEX `idx_json_import_attempts_user_started` ON `json_import_attempts` (`user_id`,`started_at`);

-- Successful legacy imports can be reconstructed. Requests rejected before a
-- database write never existed durably and intentionally remain unavailable.
INSERT OR IGNORE INTO json_import_runs (
	id,user_id,qbank_id,file_name,normalized_name,file_hash,source_file,status,
	chunk_count,completed_chunks,total_count,successful_count,invalid_count,
	skipped_duplicate_count,flagged_duplicate_count,repaired,started_at,updated_at,
	completed_at,legacy
)
SELECT
	'legacy-' || file.id,
	file.user_id,
	coalesce((
		SELECT record.qbank_id
		FROM records AS record
		WHERE record.type='questionProposals'
		  AND json_extract(record.payload,'$.importBatchId')=file.batch_id
		LIMIT 1
	),''),
	file.file_name,
	file.normalized_name,
	file.file_hash,
	file.source_file,
	CASE WHEN file.skipped_count>0 THEN 'partial' ELSE 'completed' END,
	1,1,
	file.successful_count + file.skipped_count,
	file.successful_count,
	file.skipped_count,
	0,0,0,
	file.uploaded_at,file.uploaded_at,file.uploaded_at,1
FROM imported_files AS file;

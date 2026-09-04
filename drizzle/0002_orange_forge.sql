CREATE TABLE `university_claims` (
	`university_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`claimed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_university_claims_user` ON `university_claims` (`user_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_validate_university_claim`
BEFORE INSERT ON `university_claims`
WHEN NOT EXISTS (
	SELECT 1 FROM `records`
	WHERE `type` = 'universityIds'
		AND `id` = NEW.`university_id`
		AND json_extract(`payload`, '$.claimedById') IS NULL
)
BEGIN
	SELECT RAISE(ABORT, 'University ID is not eligible or has already been claimed');
END;

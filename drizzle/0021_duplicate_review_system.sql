CREATE TABLE `duplicate_pair_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `qbank_id` text NOT NULL,
  `proposal_id` text NOT NULL,
  `source_fingerprint` text NOT NULL,
  `candidate_entity_type` text NOT NULL,
  `candidate_entity_id` text NOT NULL,
  `candidate_fingerprint` text NOT NULL,
  `classification` text NOT NULL,
  `similarity` integer NOT NULL,
  `detector_version` text NOT NULL,
  `decision` text NOT NULL,
  `reviewer_id` text NOT NULL,
  `review_note` text,
  `created_at` text NOT NULL
);

CREATE UNIQUE INDEX `idx_duplicate_pair_decisions_unchanged_pair`
ON `duplicate_pair_decisions` (`qbank_id`, `proposal_id`, `source_fingerprint`, `candidate_entity_type`, `candidate_entity_id`, `candidate_fingerprint`);

CREATE INDEX `idx_duplicate_pair_decisions_proposal`
ON `duplicate_pair_decisions` (`proposal_id`, `created_at`);

CREATE INDEX `idx_duplicate_pair_decisions_quality`
ON `duplicate_pair_decisions` (`qbank_id`, `decision`, `created_at`);

CREATE TABLE `duplicate_resolution_claims` (
  `proposal_id` text NOT NULL,
  `source_fingerprint` text NOT NULL,
  `reviewer_id` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`proposal_id`, `source_fingerprint`)
);

CREATE TABLE `duplicate_scan_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `qbank_id` text NOT NULL,
  `started_by` text NOT NULL,
  `cursor` integer NOT NULL DEFAULT 0,
  `scanned_count` integer NOT NULL DEFAULT 0,
  `flagged_count` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL,
  `detector_version` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE INDEX `idx_duplicate_scan_runs_bank`
ON `duplicate_scan_runs` (`qbank_id`, `created_at`);

CREATE TABLE `r2_usage_periods` (
	`period_start` text PRIMARY KEY NOT NULL,
	`class_a_operations` integer NOT NULL DEFAULT 0,
	`class_b_operations` integer NOT NULL DEFAULT 0,
	`updated_at` text NOT NULL
);

CREATE TABLE `question_id_allocator` (
	`scope` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `question_id_free_pool` (
	`numeric_id` integer PRIMARY KEY NOT NULL
);

INSERT INTO `question_id_allocator` (`scope`, `next_value`, `updated_at`)
SELECT
	'global',
	max(1, coalesce(max(numeric_id), 0) + 1),
	CURRENT_TIMESTAMP
FROM (
	SELECT CAST(question_id AS INTEGER) AS numeric_id
	FROM question_ids
	WHERE question_id GLOB '[0-9][0-9][0-9][0-9][0-9]'
	UNION ALL
	SELECT CAST(question_id AS INTEGER) AS numeric_id
	FROM question_registry
	WHERE question_id GLOB '[0-9][0-9][0-9][0-9][0-9]'
);

WITH RECURSIVE bounds(max_id) AS (
	SELECT max(0, coalesce(max(CAST(question_id AS INTEGER)), 0))
	FROM question_ids
), available(n, max_id) AS (
	SELECT 1, max_id FROM bounds WHERE max_id > 0
	UNION ALL
	SELECT n + 1, max_id FROM available WHERE n < max_id
)
INSERT OR IGNORE INTO question_id_free_pool(numeric_id)
SELECT n FROM available
WHERE NOT EXISTS (
	SELECT 1 FROM question_ids WHERE question_id = printf('%05d', n)
);

CREATE TRIGGER `question_id_release_to_pool`
AFTER DELETE ON `question_ids`
WHEN OLD.question_id GLOB '[0-9][0-9][0-9][0-9][0-9]'
BEGIN
	INSERT OR IGNORE INTO question_id_free_pool(numeric_id)
	VALUES(CAST(OLD.question_id AS INTEGER));
END;

ALTER TABLE `app_states` ADD `revision` integer NOT NULL DEFAULT 0;
ALTER TABLE `app_states` ADD `last_operation_id` text;

CREATE TABLE `state_sync_operations` (
  `user_id` text NOT NULL REFERENCES `profiles`(`uid`) ON DELETE CASCADE,
  `operation_id` text NOT NULL,
  `revision` integer NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`user_id`, `operation_id`)
);

CREATE INDEX `idx_state_sync_operations_created`
ON `state_sync_operations` (`created_at`);

CREATE TRIGGER `enforce_app_state_revision`
BEFORE UPDATE ON `app_states`
WHEN NEW.last_operation_id IS NOT OLD.last_operation_id
  AND NEW.revision != OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'APP_STATE_CONFLICT');
END;

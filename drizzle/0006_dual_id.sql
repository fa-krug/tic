-- Dual-ID migration: separate internal rowId from display id
-- This migration rebuilds most tables to switch from text id primary key
-- to integer row_id primary key with nullable text display id.

-- 1. Rebuild work_items with row_id as primary key
CREATE TABLE `work_items_new` (
  `row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `id` text,
  `title` text NOT NULL,
  `type` text NOT NULL,
  `status` text NOT NULL,
  `iteration` text NOT NULL DEFAULT '',
  `priority` text NOT NULL DEFAULT '',
  `assignee` text NOT NULL DEFAULT '',
  `description` text NOT NULL DEFAULT '',
  `parent` integer,
  `created` text NOT NULL,
  `updated` text NOT NULL,
  `deleted_at` text
);--> statement-breakpoint

-- Copy existing data: old text id becomes display id, row_id is auto-assigned
INSERT INTO `work_items_new` (`id`, `title`, `type`, `status`, `iteration`, `priority`, `assignee`, `description`, `parent`, `created`, `updated`, `deleted_at`)
SELECT `id`, `title`, `type`, `status`, `iteration`, `priority`, `assignee`, `description`, NULL, `created`, `updated`, `deleted_at`
FROM `work_items`;--> statement-breakpoint

-- Fix parent references: map old text parent to new row_id
UPDATE `work_items_new` SET `parent` = (
  SELECT `p`.`row_id` FROM `work_items_new` `p`
  WHERE `p`.`id` = (
    SELECT `old`.`parent` FROM `work_items` `old`
    WHERE `old`.`id` = `work_items_new`.`id`
  )
) WHERE `work_items_new`.`id` IN (
  SELECT `id` FROM `work_items` WHERE `parent` IS NOT NULL
);--> statement-breakpoint

DROP TABLE `work_items`;--> statement-breakpoint
ALTER TABLE `work_items_new` RENAME TO `work_items`;--> statement-breakpoint

-- Recreate work_items indexes
CREATE UNIQUE INDEX `idx_display_id` ON `work_items` (`id`);--> statement-breakpoint
CREATE INDEX `idx_status` ON `work_items` (`status`);--> statement-breakpoint
CREATE INDEX `idx_type` ON `work_items` (`type`);--> statement-breakpoint
CREATE INDEX `idx_assignee` ON `work_items` (`assignee`);--> statement-breakpoint
CREATE INDEX `idx_priority` ON `work_items` (`priority`);--> statement-breakpoint
CREATE INDEX `idx_iteration` ON `work_items` (`iteration`);--> statement-breakpoint
CREATE INDEX `idx_parent` ON `work_items` (`parent`);--> statement-breakpoint
CREATE INDEX `idx_deleted_iteration` ON `work_items` (`deleted_at`, `iteration`);--> statement-breakpoint
CREATE INDEX `idx_deleted_status` ON `work_items` (`deleted_at`, `status`);--> statement-breakpoint
CREATE INDEX `idx_deleted_assignee` ON `work_items` (`deleted_at`, `assignee`);--> statement-breakpoint

-- 2. Rebuild work_item_labels with integer FK
CREATE TABLE `work_item_labels_new` (
  `work_item_row_id` integer NOT NULL REFERENCES `work_items`(`row_id`) ON DELETE CASCADE,
  `label` text NOT NULL,
  PRIMARY KEY (`work_item_row_id`, `label`)
);--> statement-breakpoint

INSERT INTO `work_item_labels_new` (`work_item_row_id`, `label`)
SELECT `w`.`row_id`, `l`.`label`
FROM `work_item_labels` `l`
JOIN `work_items` `w` ON `w`.`id` = `l`.`work_item_id`;--> statement-breakpoint

DROP TABLE `work_item_labels`;--> statement-breakpoint
ALTER TABLE `work_item_labels_new` RENAME TO `work_item_labels`;--> statement-breakpoint
CREATE INDEX `idx_label` ON `work_item_labels` (`label`);--> statement-breakpoint

-- 3. Rebuild work_item_deps with integer FKs
CREATE TABLE `work_item_deps_new` (
  `work_item_row_id` integer NOT NULL REFERENCES `work_items`(`row_id`) ON DELETE CASCADE,
  `depends_on_row_id` integer NOT NULL REFERENCES `work_items`(`row_id`) ON DELETE CASCADE,
  PRIMARY KEY (`work_item_row_id`, `depends_on_row_id`)
);--> statement-breakpoint

INSERT INTO `work_item_deps_new` (`work_item_row_id`, `depends_on_row_id`)
SELECT `w1`.`row_id`, `w2`.`row_id`
FROM `work_item_deps` `d`
JOIN `work_items` `w1` ON `w1`.`id` = `d`.`work_item_id`
JOIN `work_items` `w2` ON `w2`.`id` = `d`.`depends_on_id`;--> statement-breakpoint

DROP TABLE `work_item_deps`;--> statement-breakpoint
ALTER TABLE `work_item_deps_new` RENAME TO `work_item_deps`;--> statement-breakpoint
CREATE INDEX `idx_dep_target` ON `work_item_deps` (`depends_on_row_id`);--> statement-breakpoint

-- 4. Rebuild comments with integer FK
CREATE TABLE `comments_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `work_item_row_id` integer NOT NULL REFERENCES `work_items`(`row_id`) ON DELETE CASCADE,
  `author` text NOT NULL DEFAULT '',
  `body` text NOT NULL,
  `created` text NOT NULL
);--> statement-breakpoint

INSERT INTO `comments_new` (`id`, `work_item_row_id`, `author`, `body`, `created`)
SELECT `c`.`id`, `w`.`row_id`, `c`.`author`, `c`.`body`, `c`.`created`
FROM `comments` `c`
JOIN `work_items` `w` ON `w`.`id` = `c`.`work_item_id`;--> statement-breakpoint

DROP TABLE `comments`;--> statement-breakpoint
ALTER TABLE `comments_new` RENAME TO `comments`;--> statement-breakpoint
CREATE INDEX `idx_comment_item` ON `comments` (`work_item_row_id`);--> statement-breakpoint

-- 5. Rebuild sync_queue with integer item_row_id (clear existing queue)
DROP TABLE `sync_queue`;--> statement-breakpoint
CREATE TABLE `sync_queue` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `action` text NOT NULL,
  `item_row_id` integer NOT NULL,
  `timestamp` text NOT NULL,
  `comment_data` text,
  `template_slug` text
);--> statement-breakpoint
CREATE INDEX `idx_queue_item` ON `sync_queue` (`item_row_id`, `action`);--> statement-breakpoint

-- 6. Rebuild undo_stack with metadata column (clear existing stack)
DROP TABLE IF EXISTS `undo_item_snapshot_deps`;--> statement-breakpoint
DROP TABLE IF EXISTS `undo_item_snapshot_labels`;--> statement-breakpoint
DROP TABLE IF EXISTS `undo_item_snapshot`;--> statement-breakpoint
DROP TABLE `undo_stack`;--> statement-breakpoint
CREATE TABLE `undo_stack` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `action` text NOT NULL,
  `metadata` text NOT NULL,
  `created_at` text NOT NULL
);--> statement-breakpoint

-- 7. Rebuild file_sync_state with integer FK
DROP TABLE `file_sync_state`;--> statement-breakpoint
CREATE TABLE `file_sync_state` (
  `item_row_id` integer PRIMARY KEY NOT NULL,
  `display_id` text NOT NULL,
  `hash` text NOT NULL,
  `synced_at` text NOT NULL
);--> statement-breakpoint

-- 8. Rebuild pr_item_links with integer FK
CREATE TABLE `pr_item_links_new` (
  `pr_id` text NOT NULL REFERENCES `pull_requests`(`id`) ON DELETE CASCADE,
  `item_row_id` integer NOT NULL REFERENCES `work_items`(`row_id`) ON DELETE CASCADE,
  PRIMARY KEY (`pr_id`, `item_row_id`)
);--> statement-breakpoint

INSERT INTO `pr_item_links_new` (`pr_id`, `item_row_id`)
SELECT `pl`.`pr_id`, `w`.`row_id`
FROM `pr_item_links` `pl`
JOIN `work_items` `w` ON `w`.`id` = `pl`.`item_id`;--> statement-breakpoint

DROP TABLE `pr_item_links`;--> statement-breakpoint
ALTER TABLE `pr_item_links_new` RENAME TO `pr_item_links`;--> statement-breakpoint
CREATE INDEX `idx_pr_link_item` ON `pr_item_links` (`item_row_id`);--> statement-breakpoint

-- 9. Rebuild project_config without next_id
CREATE TABLE `project_config_new` (
  `id` integer PRIMARY KEY DEFAULT 1,
  `backend` text NOT NULL DEFAULT 'none',
  `current_iteration` text NOT NULL DEFAULT '',
  `branch_mode` text NOT NULL DEFAULT 'branch',
  `branch_command` text NOT NULL DEFAULT '',
  `copy_to_clipboard` integer NOT NULL DEFAULT true,
  `auto_update` integer NOT NULL DEFAULT true,
  `default_type` text NOT NULL DEFAULT 'issue',
  `show_detail_panel` integer NOT NULL DEFAULT false,
  `default_view` text NOT NULL DEFAULT '',
  `theme` text NOT NULL DEFAULT 'default'
);--> statement-breakpoint

INSERT INTO `project_config_new` (`id`, `backend`, `current_iteration`, `branch_mode`, `branch_command`, `copy_to_clipboard`, `auto_update`, `default_type`, `show_detail_panel`, `default_view`, `theme`)
SELECT `id`, `backend`, `current_iteration`, `branch_mode`, `branch_command`, `copy_to_clipboard`, `auto_update`, `default_type`, `show_detail_panel`, `default_view`, `theme`
FROM `project_config`;--> statement-breakpoint

DROP TABLE `project_config`;--> statement-breakpoint
ALTER TABLE `project_config_new` RENAME TO `project_config`;

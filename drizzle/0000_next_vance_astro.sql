CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_item_id` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_comment_item` ON `comments` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `file_sync_state` (
	`item_id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `iterations` (
	`name` text PRIMARY KEY NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jira_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`site` text DEFAULT '' NOT NULL,
	`project` text DEFAULT '' NOT NULL,
	`board_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`backend` text DEFAULT 'none' NOT NULL,
	`current_iteration` text DEFAULT '' NOT NULL,
	`next_id` integer DEFAULT 1 NOT NULL,
	`branch_mode` text DEFAULT 'branch' NOT NULL,
	`branch_command` text DEFAULT '' NOT NULL,
	`copy_to_clipboard` integer DEFAULT true NOT NULL,
	`auto_update` integer DEFAULT true NOT NULL,
	`default_type` text DEFAULT 'issue' NOT NULL,
	`show_detail_panel` integer DEFAULT false NOT NULL,
	`default_view` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_view_filters` (
	`view_name` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`view_name`, `field`, `value`),
	FOREIGN KEY (`view_name`) REFERENCES `saved_views`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_view_sort_entries` (
	`view_name` text NOT NULL,
	`column` text NOT NULL,
	`direction` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`view_name`, `sort_order`),
	FOREIGN KEY (`view_name`) REFERENCES `saved_views`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_views` (
	`name` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `statuses` (
	`name` text PRIMARY KEY NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`item_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`comment_data` text,
	`template_slug` text
);
--> statement-breakpoint
CREATE INDEX `idx_queue_item` ON `sync_queue` (`item_id`,`action`);--> statement-breakpoint
CREATE TABLE `template_deps` (
	`template_slug` text NOT NULL,
	`depends_on_id` text NOT NULL,
	PRIMARY KEY(`template_slug`, `depends_on_id`),
	FOREIGN KEY (`template_slug`) REFERENCES `templates`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `template_labels` (
	`template_slug` text NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`template_slug`, `label`),
	FOREIGN KEY (`template_slug`) REFERENCES `templates`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT '' NOT NULL,
	`assignee` text DEFAULT '' NOT NULL,
	`iteration` text DEFAULT '' NOT NULL,
	`parent` text,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `undo_item_snapshot` (
	`undo_id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`iteration` text NOT NULL,
	`priority` text NOT NULL,
	`assignee` text NOT NULL,
	`description` text NOT NULL,
	`parent` text,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`undo_id`) REFERENCES `undo_stack`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `undo_item_snapshot_deps` (
	`undo_id` integer NOT NULL,
	`depends_on_id` text NOT NULL,
	PRIMARY KEY(`undo_id`, `depends_on_id`),
	FOREIGN KEY (`undo_id`) REFERENCES `undo_stack`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `undo_item_snapshot_labels` (
	`undo_id` integer NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`undo_id`, `label`),
	FOREIGN KEY (`undo_id`) REFERENCES `undo_stack`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `undo_stack` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_item_deps` (
	`work_item_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	PRIMARY KEY(`work_item_id`, `depends_on_id`),
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dep_target` ON `work_item_deps` (`depends_on_id`);--> statement-breakpoint
CREATE TABLE `work_item_labels` (
	`work_item_id` text NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`work_item_id`, `label`),
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_label` ON `work_item_labels` (`label`);--> statement-breakpoint
CREATE TABLE `work_item_types` (
	`name` text PRIMARY KEY NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`iteration` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT '' NOT NULL,
	`assignee` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`parent` text,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_status` ON `work_items` (`status`);--> statement-breakpoint
CREATE INDEX `idx_type` ON `work_items` (`type`);--> statement-breakpoint
CREATE INDEX `idx_assignee` ON `work_items` (`assignee`);--> statement-breakpoint
CREATE INDEX `idx_priority` ON `work_items` (`priority`);--> statement-breakpoint
CREATE INDEX `idx_iteration` ON `work_items` (`iteration`);--> statement-breakpoint
CREATE INDEX `idx_parent` ON `work_items` (`parent`);
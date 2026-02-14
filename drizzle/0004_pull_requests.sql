CREATE TABLE `pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`source_branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`remote_id` text,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pr_status` ON `pull_requests` (`status`);--> statement-breakpoint
CREATE INDEX `idx_pr_remote` ON `pull_requests` (`remote_id`);--> statement-breakpoint
CREATE TABLE `pr_item_links` (
	`pr_id` text NOT NULL REFERENCES `pull_requests`(`id`) ON DELETE CASCADE,
	`item_id` text NOT NULL REFERENCES `work_items`(`id`) ON DELETE CASCADE,
	PRIMARY KEY (`pr_id`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pr_link_item` ON `pr_item_links` (`item_id`);

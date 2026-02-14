CREATE INDEX `idx_deleted_iteration` ON `work_items` (`deleted_at`,`iteration`);--> statement-breakpoint
CREATE INDEX `idx_deleted_status` ON `work_items` (`deleted_at`,`status`);--> statement-breakpoint
CREATE INDEX `idx_deleted_assignee` ON `work_items` (`deleted_at`,`assignee`);
CREATE TABLE `color_mappings` (
	`field_type` text NOT NULL,
	`value` text NOT NULL,
	`bg` text NOT NULL,
	`fg` text NOT NULL,
	PRIMARY KEY(`field_type`, `value`)
);

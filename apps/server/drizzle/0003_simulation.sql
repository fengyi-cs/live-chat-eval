CREATE TABLE `scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`default_gap_sec` real DEFAULT 3 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scripts_name_unique` ON `scripts` (`name`);--> statement-breakpoint
ALTER TABLE `messages` ADD `gen_first_token_ms` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `gen_total_ms` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `status` text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `error` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `config_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `script_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `snapshot` text;
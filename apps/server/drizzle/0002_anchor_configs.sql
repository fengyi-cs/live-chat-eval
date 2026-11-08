CREATE TABLE `anchor_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`anchor_name` text NOT NULL,
	`name` text NOT NULL,
	`provider_id` text,
	`model` text,
	`temperature` real,
	`max_tokens` integer,
	`context_turns` integer NOT NULL,
	`reply_rules` text NOT NULL,
	`proactive_prompt` text NOT NULL,
	`strategy` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`anchor_name`) REFERENCES `anchors`(`name`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anchor_configs_anchor_name` ON `anchor_configs` (`anchor_name`,`name`);
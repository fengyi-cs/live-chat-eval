PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_anchor_configs` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_anchor_configs`("id", "name", "provider_id", "model", "temperature", "max_tokens", "context_turns", "reply_rules", "proactive_prompt", "strategy", "created_at") SELECT "id", "name", "provider_id", "model", "temperature", "max_tokens", "context_turns", "reply_rules", "proactive_prompt", "strategy", "created_at" FROM `anchor_configs`;--> statement-breakpoint
DROP TABLE `anchor_configs`;--> statement-breakpoint
ALTER TABLE `__new_anchor_configs` RENAME TO `anchor_configs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `anchor_configs_name_unique` ON `anchor_configs` (`name`);--> statement-breakpoint
ALTER TABLE `providers` DROP COLUMN `default_model`;
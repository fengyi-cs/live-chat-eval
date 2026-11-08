CREATE TABLE `anchors` (
	`name` text PRIMARY KEY NOT NULL,
	`code` text,
	`persona_prompt` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`time` text NOT NULL,
	`speaker` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`replies_to` text,
	`latency_ms` integer,
	`proactive` integer,
	`actions` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_session_seq` ON `messages` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`anchor_name` text NOT NULL,
	`title` text,
	`started_at` text,
	`ended_at` text,
	`unanswered` text NOT NULL,
	`orphan_actions` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`anchor_name`) REFERENCES `anchors`(`name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_external_id_unique` ON `sessions` (`external_id`);--> statement-breakpoint
CREATE TABLE `speaker_roles` (
	`speaker` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL
);

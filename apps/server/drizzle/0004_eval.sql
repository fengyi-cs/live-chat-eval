CREATE TABLE `eval_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`eval_id` text NOT NULL,
	`kind` text NOT NULL,
	`seq` integer,
	`proactive` integer NOT NULL,
	`status` text NOT NULL,
	`scores` text,
	`error` text,
	`calls` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`eval_id`) REFERENCES `evals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `eval_items_eval` ON `eval_items` (`eval_id`);--> statement-breakpoint
CREATE TABLE `evals` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`rubric_id` text,
	`rubric_name` text NOT NULL,
	`rubric` text NOT NULL,
	`provider_name` text,
	`model` text,
	`temperature` real,
	`samples` integer NOT NULL,
	`attempts` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`rules` text NOT NULL,
	`summary` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rubric_id`) REFERENCES `rubrics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `evals_session` ON `evals` (`session_id`);--> statement-breakpoint
CREATE TABLE `rubrics` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rubric` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rubrics_name_unique` ON `rubrics` (`name`);
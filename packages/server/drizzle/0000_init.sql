CREATE TABLE `candles` (
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`open` integer NOT NULL,
	`high` integer NOT NULL,
	`low` integer NOT NULL,
	`close` integer NOT NULL,
	`volume` integer NOT NULL,
	`provider` text NOT NULL,
	PRIMARY KEY(`symbol`, `date`)
);
--> statement-breakpoint
CREATE TABLE `cash_flows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`external_id` text,
	`note` text,
	`import_batch_id` integer,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_flows_external_id_unique` ON `cash_flows` (`external_id`);--> statement-breakpoint
CREATE INDEX `cash_flows_occurred_at_idx` ON `cash_flows` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `executions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` integer NOT NULL,
	`price` integer NOT NULL,
	`commission` integer DEFAULT 0 NOT NULL,
	`other_fees` integer DEFAULT 0 NOT NULL,
	`executed_at` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`import_batch_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `executions_external_id_unique` ON `executions` (`external_id`);--> statement-breakpoint
CREATE INDEX `executions_symbol_executed_at_idx` ON `executions` (`symbol`,`executed_at`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	`imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`rows_inserted` integer DEFAULT 0 NOT NULL,
	`rows_skipped_duplicate` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `screenshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trade_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`caption` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stop_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trade_id` integer NOT NULL,
	`stop_price` integer NOT NULL,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stop_changes_trade_idx` ON `stop_changes` (`trade_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `trade_executions` (
	`trade_id` integer NOT NULL,
	`execution_id` integer NOT NULL,
	PRIMARY KEY(`trade_id`, `execution_id`),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_executions_execution_idx` ON `trade_executions` (`execution_id`);--> statement-breakpoint
CREATE TABLE `trade_tags` (
	`trade_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`trade_id`, `tag_id`),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stable_key` integer NOT NULL,
	`symbol` text NOT NULL,
	`direction` text DEFAULT 'LONG' NOT NULL,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`initial_stop` integer,
	`planned_risk_override` integer,
	`target` integer,
	`setup_tag_id` integer,
	`thesis` text,
	`review` text,
	`emotion` text,
	`execution_rating` integer,
	`followed_plan` integer,
	`orphaned_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`setup_tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trades_stable_key_idx` ON `trades` (`stable_key`);--> statement-breakpoint
CREATE INDEX `trades_closed_at_idx` ON `trades` (`closed_at`);--> statement-breakpoint
CREATE INDEX `trades_symbol_idx` ON `trades` (`symbol`);
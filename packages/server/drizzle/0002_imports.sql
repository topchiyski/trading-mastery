CREATE TABLE `import_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`mapping` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_presets_name_unique` ON `import_presets` (`name`);--> statement-breakpoint
ALTER TABLE `import_batches` ADD `rows_error` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `committed_at` text;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `undone_at` text;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `payload` text;
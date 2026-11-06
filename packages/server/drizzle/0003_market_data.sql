CREATE TABLE `candle_coverage` (
	`symbol` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`provider` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`symbol`, `from_date`, `to_date`)
);
--> statement-breakpoint
ALTER TABLE `candles` ADD `adj_close` integer;--> statement-breakpoint
ALTER TABLE `candles` ADD `split_factor` real;
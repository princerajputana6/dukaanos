CREATE TABLE `stock_count_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_count_id` text NOT NULL,
	`business_id` text NOT NULL,
	`product_id` text NOT NULL,
	`expected_milli` integer NOT NULL,
	`counted_milli` integer NOT NULL,
	`diff_milli` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stock_count_lines_count_idx` ON `stock_count_lines` (`stock_count_id`);--> statement-breakpoint
CREATE TABLE `stock_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`note` text,
	`lines_count` integer DEFAULT 0 NOT NULL,
	`diff_count` integer DEFAULT 0 NOT NULL,
	`net_delta_milli` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stock_counts_business_created_idx` ON `stock_counts` (`business_id`,`created_at`);
CREATE TABLE `pos_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`opening_cash_paise` integer DEFAULT 0 NOT NULL,
	`opened_by` text,
	`opened_at` integer NOT NULL,
	`expected_cash_paise` integer,
	`counted_cash_paise` integer,
	`difference_paise` integer,
	`note` text,
	`closed_by` text,
	`closed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pos_shifts_business_status_idx` ON `pos_shifts` (`business_id`,`status`,`opened_at`);
CREATE TABLE `quote_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`business_name` text NOT NULL,
	`mobile` text NOT NULL,
	`email` text,
	`city` text,
	`business_type` text,
	`outlets` text,
	`message` text,
	`status` text DEFAULT 'NEW' NOT NULL,
	`admin_notes` text,
	`source` text,
	`ip` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quote_requests_status_created_idx` ON `quote_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `quote_requests_mobile_idx` ON `quote_requests` (`mobile`);
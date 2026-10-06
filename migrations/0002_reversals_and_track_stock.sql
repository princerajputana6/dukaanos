CREATE TABLE `reversals` (
	`business_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`reason` text,
	`created_by` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`business_id`, `entity_type`, `entity_id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `track_stock` integer DEFAULT true NOT NULL;
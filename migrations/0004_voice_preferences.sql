CREATE TABLE `voice_preferences` (
	`business_id` text NOT NULL,
	`query_norm` text NOT NULL,
	`product_id` text NOT NULL,
	`uses` integer DEFAULT 1 NOT NULL,
	`last_used_at` integer NOT NULL,
	PRIMARY KEY(`business_id`, `query_norm`)
);

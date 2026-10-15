CREATE TABLE `ai_budgets` (
	`business_id` text PRIMARY KEY NOT NULL,
	`monthly_cap_micros` integer,
	`alert_bp` integer DEFAULT 8000 NOT NULL,
	`kill_switch` integer DEFAULT false NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`user_id` text,
	`request_id` text,
	`interaction_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`task` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`audio_ms` integer DEFAULT 0 NOT NULL,
	`est_cost_micros` integer DEFAULT 0 NOT NULL,
	`price_version` text NOT NULL,
	`latency_ms` integer,
	`status` text NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`routing_reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_business_created_idx` ON `ai_usage_events` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_task_idx` ON `ai_usage_events` (`task`);--> statement-breakpoint
CREATE INDEX `ai_usage_created_idx` ON `ai_usage_events` (`created_at`);
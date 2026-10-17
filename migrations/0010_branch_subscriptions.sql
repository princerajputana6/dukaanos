CREATE TABLE `branch_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`provider_sub_id` text NOT NULL,
	`provider_plan_id` text NOT NULL,
	`status` text DEFAULT 'CREATED' NOT NULL,
	`branch_business_id` text,
	`amount_paise` integer NOT NULL,
	`current_period_end` integer,
	`last_payment_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branch_subs_provider_uq` ON `branch_subscriptions` (`provider_sub_id`);--> statement-breakpoint
CREATE INDEX `branch_subs_tenant_idx` ON `branch_subscriptions` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `branch_subs_branch_idx` ON `branch_subscriptions` (`branch_business_id`);
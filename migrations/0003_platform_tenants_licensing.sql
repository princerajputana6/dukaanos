CREATE TABLE `agencies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact_name` text,
	`phone` text,
	`email` text,
	`city` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `license_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`action` text NOT NULL,
	`before_data` text,
	`after_data` text,
	`note` text,
	`actor_user_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `le_tenant_created_idx` ON `license_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`plan` text NOT NULL,
	`status` text NOT NULL,
	`max_branches` integer NOT NULL,
	`max_users` integer NOT NULL,
	`valid_until` text,
	`note` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `licenses_tenant_uq` ON `licenses` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `licenses_status_idx` ON `licenses` (`status`,`valid_until`);--> statement-breakpoint
CREATE TABLE `platform_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`summary` text NOT NULL,
	`data` text,
	`ip` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pal_created_idx` ON `platform_audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `pal_target_idx` ON `platform_audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`agency_id` text,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tenants_agency_idx` ON `tenants` (`agency_id`);--> statement-breakpoint
CREATE INDEX `tenants_owner_idx` ON `tenants` (`owner_user_id`);--> statement-breakpoint
ALTER TABLE `businesses` ADD `tenant_id` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `branch_code` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `status` text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
CREATE INDEX `businesses_tenant_idx` ON `businesses` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `businesses_status_idx` ON `businesses` (`status`);--> statement-breakpoint
ALTER TABLE `users` ADD `platform_role` text;--> statement-breakpoint
-- Backfill: every existing shop becomes its own tenant (main branch) with an active,
-- non-expiring BASIC licence, so nobody already using Suvakta is locked out.
INSERT INTO `tenants` (`id`, `name`, `agency_id`, `owner_user_id`, `status`, `notes`, `created_at`, `updated_at`)
SELECT 'tn_' || `id`, `name`, NULL, `created_by`, 'ACTIVE', 'Created by migration 0003', `created_at`, `updated_at` FROM `businesses` WHERE `tenant_id` IS NULL;
--> statement-breakpoint
UPDATE `businesses` SET `tenant_id` = 'tn_' || `id`, `branch_code` = 'MAIN' WHERE `tenant_id` IS NULL;
--> statement-breakpoint
INSERT INTO `licenses` (`id`, `tenant_id`, `plan`, `status`, `max_branches`, `max_users`, `valid_until`, `note`, `updated_by`, `created_at`, `updated_at`)
SELECT 'lic_' || `id`, `id`, 'BASIC', 'ACTIVE', 1, 5, NULL, 'Existing shop — migrated licence', NULL, `created_at`, `updated_at` FROM `tenants` WHERE `id` NOT IN (SELECT `tenant_id` FROM `licenses`);

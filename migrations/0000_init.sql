CREATE TABLE `ai_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`user_id` text NOT NULL,
	`voice_command_id` text,
	`input_text` text NOT NULL,
	`parser` text NOT NULL,
	`model` text,
	`intent` text NOT NULL,
	`confidence_pct` integer DEFAULT 0 NOT NULL,
	`language` text,
	`parsed_json` text,
	`proposal_json` text,
	`clarification_json` text,
	`context_json` text,
	`status` text NOT NULL,
	`response_text` text,
	`result_type` text,
	`result_id` text,
	`latency_ms` integer,
	`error_code` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_business_user_created_idx` ON `ai_interactions` (`business_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_business_status_idx` ON `ai_interactions` (`business_id`,`status`);--> statement-breakpoint
CREATE TABLE `app_events` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text,
	`user_id` text,
	`name` text NOT NULL,
	`props_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_business_created_idx` ON `app_events` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`summary` text,
	`before_data` text,
	`after_data` text,
	`source` text NOT NULL,
	`request_id` text,
	`ip` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_business_created_idx` ON `audit_logs` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_business_entity_idx` ON `audit_logs` (`business_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_business_user_idx` ON `audit_logs` (`business_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `business_members` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bm_business_user_uq` ON `business_members` (`business_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `bm_user_idx` ON `business_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `business_settings` (
	`business_id` text PRIMARY KEY NOT NULL,
	`prices_include_gst` integer DEFAULT true NOT NULL,
	`allow_negative_stock` integer DEFAULT false NOT NULL,
	`default_low_stock_milli` integer DEFAULT 5000 NOT NULL,
	`invoice_prefix` text DEFAULT 'INV' NOT NULL,
	`language` text DEFAULT 'hinglish' NOT NULL,
	`voice_provider` text DEFAULT 'auto' NOT NULL,
	`ai_enabled` integer DEFAULT true NOT NULL,
	`low_stock_notifications` integer DEFAULT true NOT NULL,
	`daily_summary_notifications` integer DEFAULT true NOT NULL,
	`outstanding_reminders` integer DEFAULT true NOT NULL,
	`feature_flags` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`city` text,
	`state_code` text,
	`phone` text,
	`address` text,
	`onboarding_step` integer DEFAULT 1 NOT NULL,
	`onboarded_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`business_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE `customer_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`balance_after_paise` integer NOT NULL,
	`method` text,
	`reference_type` text,
	`reference_id` text,
	`note` text,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`txn_date` text NOT NULL,
	`source` text DEFAULT 'WEB' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ct_business_customer_idx` ON `customer_transactions` (`business_id`,`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ct_business_created_idx` ON `customer_transactions` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email` text,
	`address` text,
	`state_code` text,
	`notes` text,
	`balance_paise` integer DEFAULT 0 NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_txn_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customers_business_idx` ON `customers` (`business_id`,`is_active`,`name`);--> statement-breakpoint
CREATE INDEX `customers_business_phone_idx` ON `customers` (`business_id`,`phone`);--> statement-breakpoint
CREATE INDEX `customers_business_balance_idx` ON `customers` (`business_id`,`balance_paise`);--> statement-breakpoint
CREATE TABLE `daily_summaries` (
	`business_id` text NOT NULL,
	`date` text NOT NULL,
	`sales_paise` integer NOT NULL,
	`orders` integer NOT NULL,
	`gross_profit_paise` integer NOT NULL,
	`expenses_paise` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`business_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ec_business_name_uq` ON `expense_categories` (`business_id`,`name`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`category_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`txn_date` text NOT NULL,
	`payment_method` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`source` text DEFAULT 'WEB' NOT NULL,
	`created_by` text,
	`reversed_at` integer,
	`reversed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `expenses_business_date_idx` ON `expenses` (`business_id`,`txn_date`,`status`);--> statement-breakpoint
CREATE INDEX `expenses_business_category_idx` ON `expenses` (`business_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `expenses_business_created_idx` ON `expenses` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `gst_settings` (
	`business_id` text PRIMARY KEY NOT NULL,
	`gstin` text,
	`legal_name` text,
	`state_code` text,
	`registration_status` text DEFAULT 'UNREGISTERED' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`business_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`business_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idem_created_idx` ON `idempotency_keys` (`created_at`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`product_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`before_milli` integer NOT NULL,
	`after_milli` integer NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`reason` text,
	`txn_date` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `im_business_product_idx` ON `inventory_movements` (`business_id`,`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `im_business_created_idx` ON `inventory_movements` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `im_business_ref_idx` ON `inventory_movements` (`business_id`,`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`dedupe_key` text,
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notif_business_created_idx` ON `notifications` (`business_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notif_business_dedupe_uq` ON `notifications` (`business_id`,`dedupe_key`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prt_user_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`code` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`direction` text NOT NULL,
	`party_type` text,
	`party_id` text,
	`method` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`txn_date` text NOT NULL,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_business_date_idx` ON `payments` (`business_id`,`txn_date`,`status`);--> statement-breakpoint
CREATE INDEX `payments_business_ref_idx` ON `payments` (`business_id`,`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`key` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`product_id` text NOT NULL,
	`alias` text NOT NULL,
	`alias_norm` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pa_business_product_alias_uq` ON `product_aliases` (`business_id`,`product_id`,`alias_norm`);--> statement-breakpoint
CREATE INDEX `pa_business_alias_idx` ON `product_aliases` (`business_id`,`alias_norm`);--> statement-breakpoint
CREATE TABLE `product_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pc_business_name_uq` ON `product_categories` (`business_id`,`name`);--> statement-breakpoint
CREATE TABLE `product_units` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`factor_milli` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pu_business_product_name_uq` ON `product_units` (`business_id`,`product_id`,`name`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text,
	`barcode` text,
	`category_id` text,
	`brand` text,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`purchase_price_paise` integer DEFAULT 0 NOT NULL,
	`avg_cost_paise` integer DEFAULT 0 NOT NULL,
	`selling_price_paise` integer DEFAULT 0 NOT NULL,
	`mrp_paise` integer,
	`gst_rate_bp` integer DEFAULT 0 NOT NULL,
	`hsn_code` text,
	`opening_stock_milli` integer DEFAULT 0 NOT NULL,
	`current_stock_milli` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold_milli` integer DEFAULT 0 NOT NULL,
	`supplier_id` text,
	`image_key` text,
	`search_text` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `products_business_idx` ON `products` (`business_id`,`is_active`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_business_sku_uq` ON `products` (`business_id`,`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_business_barcode_uq` ON `products` (`business_id`,`barcode`);--> statement-breakpoint
CREATE INDEX `products_business_category_idx` ON `products` (`business_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `products_business_supplier_idx` ON `products` (`business_id`,`supplier_id`);--> statement-breakpoint
CREATE INDEX `products_business_search_idx` ON `products` (`business_id`,`search_text`);--> statement-breakpoint
CREATE TABLE `purchase_items` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_cost_paise` integer NOT NULL,
	`discount_paise` integer DEFAULT 0 NOT NULL,
	`gst_rate_bp` integer DEFAULT 0 NOT NULL,
	`taxable_paise` integer NOT NULL,
	`cgst_paise` integer DEFAULT 0 NOT NULL,
	`sgst_paise` integer DEFAULT 0 NOT NULL,
	`igst_paise` integer DEFAULT 0 NOT NULL,
	`tax_paise` integer DEFAULT 0 NOT NULL,
	`total_paise` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pi_business_purchase_idx` ON `purchase_items` (`business_id`,`purchase_id`);--> statement-breakpoint
CREATE INDEX `pi_business_product_idx` ON `purchase_items` (`business_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`purchase_number` text NOT NULL,
	`supplier_id` text,
	`bill_number` text,
	`txn_date` text NOT NULL,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`payment_method` text NOT NULL,
	`payment_status` text NOT NULL,
	`subtotal_paise` integer NOT NULL,
	`discount_paise` integer DEFAULT 0 NOT NULL,
	`taxable_paise` integer NOT NULL,
	`cgst_paise` integer DEFAULT 0 NOT NULL,
	`sgst_paise` integer DEFAULT 0 NOT NULL,
	`igst_paise` integer DEFAULT 0 NOT NULL,
	`tax_paise` integer DEFAULT 0 NOT NULL,
	`total_paise` integer NOT NULL,
	`paid_paise` integer NOT NULL,
	`credit_paise` integer DEFAULT 0 NOT NULL,
	`is_interstate` integer DEFAULT false NOT NULL,
	`prices_include_gst` integer DEFAULT false NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`source` text DEFAULT 'WEB' NOT NULL,
	`created_by` text,
	`reversed_at` integer,
	`reversed_by` text,
	`reversal_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_business_number_uq` ON `purchases` (`business_id`,`purchase_number`);--> statement-breakpoint
CREATE INDEX `purchases_business_date_idx` ON `purchases` (`business_id`,`txn_date`,`status`);--> statement-breakpoint
CREATE INDEX `purchases_business_supplier_idx` ON `purchases` (`business_id`,`supplier_id`);--> statement-breakpoint
CREATE INDEX `purchases_business_created_idx` ON `purchases` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission_key` text NOT NULL,
	PRIMARY KEY(`role_id`, `permission_key`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `roles_business_idx` ON `roles` (`business_id`);--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_price_paise` integer NOT NULL,
	`discount_paise` integer DEFAULT 0 NOT NULL,
	`gst_rate_bp` integer DEFAULT 0 NOT NULL,
	`hsn_code` text,
	`taxable_paise` integer NOT NULL,
	`cgst_paise` integer DEFAULT 0 NOT NULL,
	`sgst_paise` integer DEFAULT 0 NOT NULL,
	`igst_paise` integer DEFAULT 0 NOT NULL,
	`tax_paise` integer DEFAULT 0 NOT NULL,
	`total_paise` integer NOT NULL,
	`unit_cost_paise` integer DEFAULT 0 NOT NULL,
	`cost_paise` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `si_business_sale_idx` ON `sale_items` (`business_id`,`sale_id`);--> statement-breakpoint
CREATE INDEX `si_business_product_idx` ON `sale_items` (`business_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`customer_id` text,
	`txn_date` text NOT NULL,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`payment_method` text NOT NULL,
	`payment_status` text NOT NULL,
	`subtotal_paise` integer NOT NULL,
	`discount_paise` integer DEFAULT 0 NOT NULL,
	`taxable_paise` integer NOT NULL,
	`cgst_paise` integer DEFAULT 0 NOT NULL,
	`sgst_paise` integer DEFAULT 0 NOT NULL,
	`igst_paise` integer DEFAULT 0 NOT NULL,
	`tax_paise` integer DEFAULT 0 NOT NULL,
	`total_paise` integer NOT NULL,
	`paid_paise` integer NOT NULL,
	`credit_paise` integer DEFAULT 0 NOT NULL,
	`cost_paise` integer DEFAULT 0 NOT NULL,
	`is_interstate` integer DEFAULT false NOT NULL,
	`prices_include_gst` integer DEFAULT true NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`source` text DEFAULT 'WEB' NOT NULL,
	`created_by` text,
	`reversed_at` integer,
	`reversed_by` text,
	`reversal_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_business_invoice_uq` ON `sales` (`business_id`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `sales_business_date_idx` ON `sales` (`business_id`,`txn_date`,`status`);--> statement-breakpoint
CREATE INDEX `sales_business_created_idx` ON `sales` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_business_customer_idx` ON `sales` (`business_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `sales_business_status_idx` ON `sales` (`business_id`,`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`business_id` text,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_agent` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `stock_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`product_id` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`stock_milli` integer NOT NULL,
	`threshold_milli` integer NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `sa_business_status_idx` ON `stock_alerts` (`business_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `sa_open_product_uq` ON `stock_alerts` (`business_id`,`product_id`) WHERE status = 'OPEN';--> statement-breakpoint
CREATE TABLE `supplier_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`balance_after_paise` integer NOT NULL,
	`method` text,
	`reference_type` text,
	`reference_id` text,
	`note` text,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`txn_date` text NOT NULL,
	`source` text DEFAULT 'WEB' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `st_business_supplier_idx` ON `supplier_transactions` (`business_id`,`supplier_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `st_business_created_idx` ON `supplier_transactions` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`company` text,
	`gstin` text,
	`address` text,
	`state_code` text,
	`notes` text,
	`balance_paise` integer DEFAULT 0 NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_txn_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `suppliers_business_idx` ON `suppliers` (`business_id`,`is_active`,`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mobile` text NOT NULL,
	`email` text,
	`password_hash` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_mobile_uq` ON `users` (`mobile`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `voice_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`user_id` text NOT NULL,
	`transcript` text NOT NULL,
	`language` text,
	`stt_provider` text NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vc_business_created_idx` ON `voice_commands` (`business_id`,`created_at`);
CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`business_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`ordered_milli` integer NOT NULL,
	`received_milli` integer DEFAULT 0 NOT NULL,
	`unit_cost_paise` integer NOT NULL,
	`gst_rate_bp` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `purchase_order_lines_po_idx` ON `purchase_order_lines` (`purchase_order_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`po_number` text NOT NULL,
	`supplier_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`note` text,
	`expected_date` text,
	`subtotal_paise` integer DEFAULT 0 NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`approved_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `purchase_orders_business_status_idx` ON `purchase_orders` (`business_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `purchases` ADD `purchase_order_id` text;
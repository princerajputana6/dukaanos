-- Stock guard: a decrease may not take stock below zero unless the business allows negative stock.
CREATE TRIGGER trg_products_stock_guard
BEFORE UPDATE OF current_stock_milli ON products
FOR EACH ROW
WHEN NEW.current_stock_milli < 0
  AND NEW.current_stock_milli < OLD.current_stock_milli
  AND COALESCE((SELECT allow_negative_stock FROM business_settings WHERE business_id = NEW.business_id), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('sales.create', 'Create sales');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('sales.edit', 'Edit sales');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('sales.delete', 'Reverse (undo) sales');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('inventory.create', 'Add & edit products');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('inventory.adjust', 'Adjust stock');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('purchase.create', 'Record purchases');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('customer.create', 'Add customers');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('customer.ledger', 'Record khata credit & payments');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('supplier.create', 'Add suppliers');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('supplier.ledger', 'Record supplier payments');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('expense.create', 'Record expenses');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('reports.view', 'View reports, profit & money totals');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('settings.manage', 'Manage business settings');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('users.manage', 'Manage staff & roles');
--> statement-breakpoint
INSERT INTO permissions (key, description) VALUES ('audit.view', 'View audit log');
--> statement-breakpoint
INSERT INTO roles (id, business_id, key, name, is_system, created_at) VALUES ('role_owner', NULL, 'owner', 'Owner', 1, 0);
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'sales.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'sales.edit');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'sales.delete');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'inventory.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'inventory.adjust');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'purchase.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'customer.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'customer.ledger');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'supplier.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'supplier.ledger');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'expense.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'reports.view');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'settings.manage');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'users.manage');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_owner', 'audit.view');
--> statement-breakpoint
INSERT INTO roles (id, business_id, key, name, is_system, created_at) VALUES ('role_manager', NULL, 'manager', 'Manager', 1, 0);
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'sales.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'sales.edit');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'sales.delete');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'inventory.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'inventory.adjust');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'purchase.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'customer.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'customer.ledger');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'supplier.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'supplier.ledger');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'expense.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_manager', 'reports.view');
--> statement-breakpoint
INSERT INTO roles (id, business_id, key, name, is_system, created_at) VALUES ('role_staff', NULL, 'staff', 'Staff', 1, 0);
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_staff', 'sales.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_staff', 'inventory.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_staff', 'customer.create');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) VALUES ('role_staff', 'customer.ledger');
--> statement-breakpoint
INSERT INTO payment_methods (code, label) VALUES ('CASH', 'Cash');
--> statement-breakpoint
INSERT INTO payment_methods (code, label) VALUES ('UPI', 'UPI');
--> statement-breakpoint
INSERT INTO payment_methods (code, label) VALUES ('CARD', 'Card');
--> statement-breakpoint
INSERT INTO payment_methods (code, label) VALUES ('CREDIT', 'Credit (Udhaar)');
--> statement-breakpoint
INSERT INTO payment_methods (code, label) VALUES ('OTHER', 'Other');

/**
 * Suvakta D1 schema. Conventions (see ARCHITECTURE.md §5–6):
 *  - ids: TEXT UUIDv7 · timestamps: INTEGER epoch ms · money: *_paise INTEGER
 *  - quantities: *_milli INTEGER (1 unit = 1000) · GST rates: *_bp (basis points)
 *  - every business-owned table has business_id, leading every index
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const businessId = () => text("business_id").notNull();
const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();
const bool = (name: string) => integer(name, { mode: "boolean" });

// ─── Identity & tenancy ────────────────────────────────────────────────────────

export const users = sqliteTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    mobile: text("mobile").notNull(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    isActive: bool("is_active").notNull().default(true),
    /** Platform-level role: SUPER_ADMIN manages every tenant. NULL for shop users. */
    platformRole: text("platform_role"),
    lastLoginAt: integer("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_mobile_uq").on(t.mobile), uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the session token — the raw token only ever lives in the cookie. */
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    businessId: text("business_id"),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("prt_user_idx").on(t.userId)],
);

// ─── Platform: agencies → tenants → shops (businesses) ────────────────────────

/** Resellers / partners who onboard and support shops. */
export const agencies = sqliteTable("agencies", {
  id: id(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  city: text("city"),
  status: text("status").notNull().default("ACTIVE"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A customer account (the owner's organisation). Owns one or more shops/branches and the licence. */
export const tenants = sqliteTable(
  "tenants",
  {
    id: id(),
    name: text("name").notNull(),
    agencyId: text("agency_id"),
    ownerUserId: text("owner_user_id").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tenants_agency_idx").on(t.agencyId), index("tenants_owner_idx").on(t.ownerUserId)],
);

export const licenses = sqliteTable(
  "licenses",
  {
    id: id(),
    tenantId: text("tenant_id").notNull(),
    plan: text("plan").notNull(),
    status: text("status").notNull(),
    maxBranches: integer("max_branches").notNull(),
    maxUsers: integer("max_users").notNull(),
    /** IST date; null = no end date. */
    validUntil: text("valid_until"),
    note: text("note"),
    updatedBy: text("updated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("licenses_tenant_uq").on(t.tenantId), index("licenses_status_idx").on(t.status, t.validUntil)],
);

export const licenseEvents = sqliteTable(
  "license_events",
  {
    id: id(),
    tenantId: text("tenant_id").notNull(),
    action: text("action").notNull(),
    beforeData: text("before_data", { mode: "json" }).$type<unknown>(),
    afterData: text("after_data", { mode: "json" }).$type<unknown>(),
    note: text("note"),
    actorUserId: text("actor_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("le_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

/** Actions taken in the super admin console. */
export const platformAuditLogs = sqliteTable(
  "platform_audit_logs",
  {
    id: id(),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    summary: text("summary").notNull(),
    data: text("data", { mode: "json" }).$type<unknown>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("pal_created_idx").on(t.createdAt), index("pal_target_idx").on(t.targetType, t.targetId)],
);

export const businesses = sqliteTable(
  "businesses",
  {
  id: id(),
  /** The tenant (owner organisation) this shop/branch belongs to. */
  tenantId: text("tenant_id"),
  /** Short code shown to staff/admins, e.g. "MAIN", "BR-2". */
  branchCode: text("branch_code"),
  /** ACTIVE | SUSPENDED — a suspended shop is read-only. */
  status: text("status").notNull().default("ACTIVE"),
  name: text("name").notNull(),
  type: text("type").notNull().default("other"),
  city: text("city"),
  stateCode: text("state_code"),
  phone: text("phone"),
  address: text("address"),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  onboardedAt: integer("onboarded_at"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  },
  (t) => [index("businesses_tenant_idx").on(t.tenantId), index("businesses_status_idx").on(t.status)],
);

export const roles = sqliteTable(
  "roles",
  {
    id: id(),
    /** NULL for system roles shared by all businesses. */
    businessId: text("business_id"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    isSystem: bool("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("roles_business_idx").on(t.businessId)],
);

export const permissions = sqliteTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull().references(() => permissions.key),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const businessMembers = sqliteTable(
  "business_members",
  {
    id: id(),
    businessId: businessId().references(() => businesses.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull().references(() => roles.id),
    isActive: bool("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("bm_business_user_uq").on(t.businessId, t.userId), index("bm_user_idx").on(t.userId)],
);

export const businessSettings = sqliteTable("business_settings", {
  businessId: text("business_id").primaryKey().references(() => businesses.id, { onDelete: "cascade" }),
  pricesIncludeGst: bool("prices_include_gst").notNull().default(true),
  allowNegativeStock: bool("allow_negative_stock").notNull().default(false),
  defaultLowStockMilli: integer("default_low_stock_milli").notNull().default(5000),
  invoicePrefix: text("invoice_prefix").notNull().default("INV"),
  language: text("language").notNull().default("hinglish"),
  voiceProvider: text("voice_provider").notNull().default("auto"),
  aiEnabled: bool("ai_enabled").notNull().default(true),
  lowStockNotifications: bool("low_stock_notifications").notNull().default(true),
  dailySummaryNotifications: bool("daily_summary_notifications").notNull().default(true),
  outstandingReminders: bool("outstanding_reminders").notNull().default(true),
  featureFlags: text("feature_flags", { mode: "json" }).$type<Partial<Record<string, boolean>>>(),
  updatedAt: updatedAt(),
});

export const gstSettings = sqliteTable("gst_settings", {
  businessId: text("business_id").primaryKey().references(() => businesses.id, { onDelete: "cascade" }),
  gstin: text("gstin"),
  legalName: text("legal_name"),
  stateCode: text("state_code"),
  registrationStatus: text("registration_status").notNull().default("UNREGISTERED"),
  updatedAt: updatedAt(),
});

export const counters = sqliteTable(
  "counters",
  {
    businessId: businessId(),
    name: text("name").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.name] })],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    businessId: businessId(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.key] }), index("idem_created_idx").on(t.createdAt)],
);

/**
 * One row per reversed document. The composite PK makes a second reversal of the same
 * entity fail inside the batch (→ ALREADY_REVERSED), even under concurrency.
 */
export const reversals = sqliteTable(
  "reversals",
  {
    businessId: businessId(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    reason: text("reason"),
    createdBy: text("created_by"),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.entityType, t.entityId] })],
);

// ─── Catalogue & inventory ─────────────────────────────────────────────────────

export const productCategories = sqliteTable(
  "product_categories",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pc_business_name_uq").on(t.businessId, t.name)],
);

export const products = sqliteTable(
  "products",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    sku: text("sku"),
    barcode: text("barcode"),
    categoryId: text("category_id"),
    brand: text("brand"),
    unit: text("unit").notNull().default("pcs"),
    purchasePricePaise: integer("purchase_price_paise").notNull().default(0),
    avgCostPaise: integer("avg_cost_paise").notNull().default(0),
    sellingPricePaise: integer("selling_price_paise").notNull().default(0),
    mrpPaise: integer("mrp_paise"),
    gstRateBp: integer("gst_rate_bp").notNull().default(0),
    hsnCode: text("hsn_code"),
    openingStockMilli: integer("opening_stock_milli").notNull().default(0),
    currentStockMilli: integer("current_stock_milli").notNull().default(0),
    lowStockThresholdMilli: integer("low_stock_threshold_milli").notNull().default(0),
    /** false for services (haircut) and made-to-order items (chai): no stock checks/movements. */
    trackStock: bool("track_stock").notNull().default(true),
    supplierId: text("supplier_id"),
    imageKey: text("image_key"),
    searchText: text("search_text").notNull().default(""),
    isActive: bool("is_active").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_business_idx").on(t.businessId, t.isActive, t.name),
    uniqueIndex("products_business_sku_uq").on(t.businessId, t.sku),
    uniqueIndex("products_business_barcode_uq").on(t.businessId, t.barcode),
    index("products_business_category_idx").on(t.businessId, t.categoryId),
    index("products_business_supplier_idx").on(t.businessId, t.supplierId),
    index("products_business_search_idx").on(t.businessId, t.searchText),
  ],
);

export const productAliases = sqliteTable(
  "product_aliases",
  {
    id: id(),
    businessId: businessId(),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    aliasNorm: text("alias_norm").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("pa_business_product_alias_uq").on(t.businessId, t.productId, t.aliasNorm),
    index("pa_business_alias_idx").on(t.businessId, t.aliasNorm),
  ],
);

export const productUnits = sqliteTable(
  "product_units",
  {
    id: id(),
    businessId: businessId(),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    /** e.g. "crate", "box", "dozen" */
    name: text("name").notNull(),
    /** Base units per 1 of this unit, ×1000 (crate of 24 → 24000). */
    factorMilli: integer("factor_milli").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pu_business_product_name_uq").on(t.businessId, t.productId, t.name)],
);

export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: id(),
    businessId: businessId(),
    productId: text("product_id").notNull(),
    type: text("type").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    beforeMilli: integer("before_milli").notNull(),
    afterMilli: integer("after_milli").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    reason: text("reason"),
    txnDate: text("txn_date").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("im_business_product_idx").on(t.businessId, t.productId, t.createdAt),
    index("im_business_created_idx").on(t.businessId, t.createdAt),
    index("im_business_ref_idx").on(t.businessId, t.referenceType, t.referenceId),
  ],
);

export const stockAlerts = sqliteTable(
  "stock_alerts",
  {
    id: id(),
    businessId: businessId(),
    productId: text("product_id").notNull(),
    status: text("status").notNull().default("OPEN"),
    stockMilli: integer("stock_milli").notNull(),
    thresholdMilli: integer("threshold_milli").notNull(),
    createdAt: createdAt(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [
    index("sa_business_status_idx").on(t.businessId, t.status),
    uniqueIndex("sa_open_product_uq").on(t.businessId, t.productId).where(sql`status = 'OPEN'`),
  ],
);

// ─── Parties ──────────────────────────────────────────────────────────────────

export const customers = sqliteTable(
  "customers",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    stateCode: text("state_code"),
    notes: text("notes"),
    /** What the customer owes us (positive = outstanding). */
    balancePaise: integer("balance_paise").notNull().default(0),
    searchText: text("search_text").notNull().default(""),
    isActive: bool("is_active").notNull().default(true),
    lastTxnAt: integer("last_txn_at"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("customers_business_idx").on(t.businessId, t.isActive, t.name),
    index("customers_business_phone_idx").on(t.businessId, t.phone),
    index("customers_business_balance_idx").on(t.businessId, t.balancePaise),
  ],
);

export const customerTransactions = sqliteTable(
  "customer_transactions",
  {
    id: id(),
    businessId: businessId(),
    customerId: text("customer_id").notNull(),
    type: text("type").notNull(),
    /** Signed: positive raises the outstanding balance, negative lowers it. */
    amountPaise: integer("amount_paise").notNull(),
    balanceAfterPaise: integer("balance_after_paise").notNull(),
    method: text("method"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    note: text("note"),
    status: text("status").notNull().default("COMPLETED"),
    txnDate: text("txn_date").notNull(),
    source: text("source").notNull().default("WEB"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ct_business_customer_idx").on(t.businessId, t.customerId, t.createdAt),
    index("ct_business_created_idx").on(t.businessId, t.createdAt),
  ],
);

export const suppliers = sqliteTable(
  "suppliers",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    phone: text("phone"),
    company: text("company"),
    gstin: text("gstin"),
    address: text("address"),
    stateCode: text("state_code"),
    notes: text("notes"),
    /** What we owe the supplier (positive = payable). */
    balancePaise: integer("balance_paise").notNull().default(0),
    searchText: text("search_text").notNull().default(""),
    isActive: bool("is_active").notNull().default(true),
    lastTxnAt: integer("last_txn_at"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("suppliers_business_idx").on(t.businessId, t.isActive, t.name)],
);

export const supplierTransactions = sqliteTable(
  "supplier_transactions",
  {
    id: id(),
    businessId: businessId(),
    supplierId: text("supplier_id").notNull(),
    type: text("type").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    balanceAfterPaise: integer("balance_after_paise").notNull(),
    method: text("method"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    note: text("note"),
    status: text("status").notNull().default("COMPLETED"),
    txnDate: text("txn_date").notNull(),
    source: text("source").notNull().default("WEB"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("st_business_supplier_idx").on(t.businessId, t.supplierId, t.createdAt),
    index("st_business_created_idx").on(t.businessId, t.createdAt),
  ],
);

// ─── Sales & purchases ────────────────────────────────────────────────────────

export const sales = sqliteTable(
  "sales",
  {
    id: id(),
    businessId: businessId(),
    invoiceNumber: text("invoice_number").notNull(),
    customerId: text("customer_id"),
    txnDate: text("txn_date").notNull(),
    status: text("status").notNull().default("COMPLETED"),
    paymentMethod: text("payment_method").notNull(),
    paymentStatus: text("payment_status").notNull(),
    subtotalPaise: integer("subtotal_paise").notNull(),
    discountPaise: integer("discount_paise").notNull().default(0),
    taxablePaise: integer("taxable_paise").notNull(),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    taxPaise: integer("tax_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    paidPaise: integer("paid_paise").notNull(),
    creditPaise: integer("credit_paise").notNull().default(0),
    costPaise: integer("cost_paise").notNull().default(0),
    isInterstate: bool("is_interstate").notNull().default(false),
    pricesIncludeGst: bool("prices_include_gst").notNull().default(true),
    itemCount: integer("item_count").notNull().default(0),
    notes: text("notes"),
    source: text("source").notNull().default("WEB"),
    createdBy: text("created_by"),
    reversedAt: integer("reversed_at"),
    reversedBy: text("reversed_by"),
    reversalReason: text("reversal_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sales_business_invoice_uq").on(t.businessId, t.invoiceNumber),
    index("sales_business_date_idx").on(t.businessId, t.txnDate, t.status),
    index("sales_business_created_idx").on(t.businessId, t.createdAt),
    index("sales_business_customer_idx").on(t.businessId, t.customerId),
    index("sales_business_status_idx").on(t.businessId, t.status),
  ],
);

export const saleItems = sqliteTable(
  "sale_items",
  {
    id: id(),
    businessId: businessId(),
    saleId: text("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    unit: text("unit").notNull().default("pcs"),
    quantityMilli: integer("quantity_milli").notNull(),
    unitPricePaise: integer("unit_price_paise").notNull(),
    discountPaise: integer("discount_paise").notNull().default(0),
    gstRateBp: integer("gst_rate_bp").notNull().default(0),
    hsnCode: text("hsn_code"),
    taxablePaise: integer("taxable_paise").notNull(),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    taxPaise: integer("tax_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    unitCostPaise: integer("unit_cost_paise").notNull().default(0),
    costPaise: integer("cost_paise").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("si_business_sale_idx").on(t.businessId, t.saleId),
    index("si_business_product_idx").on(t.businessId, t.productId),
  ],
);

export const purchases = sqliteTable(
  "purchases",
  {
    id: id(),
    businessId: businessId(),
    purchaseNumber: text("purchase_number").notNull(),
    supplierId: text("supplier_id"),
    billNumber: text("bill_number"),
    purchaseOrderId: text("purchase_order_id"),
    txnDate: text("txn_date").notNull(),
    status: text("status").notNull().default("COMPLETED"),
    paymentMethod: text("payment_method").notNull(),
    paymentStatus: text("payment_status").notNull(),
    subtotalPaise: integer("subtotal_paise").notNull(),
    discountPaise: integer("discount_paise").notNull().default(0),
    taxablePaise: integer("taxable_paise").notNull(),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    taxPaise: integer("tax_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    paidPaise: integer("paid_paise").notNull(),
    creditPaise: integer("credit_paise").notNull().default(0),
    isInterstate: bool("is_interstate").notNull().default(false),
    pricesIncludeGst: bool("prices_include_gst").notNull().default(false),
    itemCount: integer("item_count").notNull().default(0),
    notes: text("notes"),
    source: text("source").notNull().default("WEB"),
    createdBy: text("created_by"),
    reversedAt: integer("reversed_at"),
    reversedBy: text("reversed_by"),
    reversalReason: text("reversal_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("purchases_business_number_uq").on(t.businessId, t.purchaseNumber),
    index("purchases_business_date_idx").on(t.businessId, t.txnDate, t.status),
    index("purchases_business_supplier_idx").on(t.businessId, t.supplierId),
    index("purchases_business_created_idx").on(t.businessId, t.createdAt),
  ],
);

export const purchaseItems = sqliteTable(
  "purchase_items",
  {
    id: id(),
    businessId: businessId(),
    purchaseId: text("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    unit: text("unit").notNull().default("pcs"),
    quantityMilli: integer("quantity_milli").notNull(),
    unitCostPaise: integer("unit_cost_paise").notNull(),
    discountPaise: integer("discount_paise").notNull().default(0),
    gstRateBp: integer("gst_rate_bp").notNull().default(0),
    taxablePaise: integer("taxable_paise").notNull(),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    taxPaise: integer("tax_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("pi_business_purchase_idx").on(t.businessId, t.purchaseId),
    index("pi_business_product_idx").on(t.businessId, t.productId),
  ],
);

// ─── Money ────────────────────────────────────────────────────────────────────

export const paymentMethods = sqliteTable("payment_methods", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
});

export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    businessId: businessId(),
    direction: text("direction").notNull(), // IN | OUT
    partyType: text("party_type"), // CUSTOMER | SUPPLIER | null
    partyId: text("party_id"),
    method: text("method").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    referenceType: text("reference_type").notNull(),
    referenceId: text("reference_id").notNull(),
    txnDate: text("txn_date").notNull(),
    status: text("status").notNull().default("COMPLETED"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_business_date_idx").on(t.businessId, t.txnDate, t.status),
    index("payments_business_ref_idx").on(t.businessId, t.referenceType, t.referenceId),
  ],
);

export const expenseCategories = sqliteTable(
  "expense_categories",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    isSystem: bool("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ec_business_name_uq").on(t.businessId, t.name)],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: id(),
    businessId: businessId(),
    categoryId: text("category_id").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    txnDate: text("txn_date").notNull(),
    paymentMethod: text("payment_method").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("COMPLETED"),
    source: text("source").notNull().default("WEB"),
    createdBy: text("created_by"),
    reversedAt: integer("reversed_at"),
    reversedBy: text("reversed_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expenses_business_date_idx").on(t.businessId, t.txnDate, t.status),
    index("expenses_business_category_idx").on(t.businessId, t.categoryId),
    index("expenses_business_created_idx").on(t.businessId, t.createdAt),
  ],
);

// ─── AI, audit, notifications ─────────────────────────────────────────────────

export const voiceCommands = sqliteTable(
  "voice_commands",
  {
    id: id(),
    businessId: businessId(),
    userId: text("user_id").notNull(),
    transcript: text("transcript").notNull(),
    language: text("language"),
    sttProvider: text("stt_provider").notNull(),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("vc_business_created_idx").on(t.businessId, t.createdAt)],
);

export const aiInteractions = sqliteTable(
  "ai_interactions",
  {
    id: id(),
    businessId: businessId(),
    userId: text("user_id").notNull(),
    voiceCommandId: text("voice_command_id"),
    inputText: text("input_text").notNull(),
    parser: text("parser").notNull(),
    model: text("model"),
    intent: text("intent").notNull(),
    confidence: integer("confidence_pct").notNull().default(0),
    language: text("language"),
    parsedJson: text("parsed_json", { mode: "json" }).$type<unknown>(),
    proposalJson: text("proposal_json", { mode: "json" }).$type<unknown>(),
    clarificationJson: text("clarification_json", { mode: "json" }).$type<unknown>(),
    contextJson: text("context_json", { mode: "json" }).$type<unknown>(),
    status: text("status").notNull(),
    responseText: text("response_text"),
    resultType: text("result_type"),
    resultId: text("result_id"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    expiresAt: integer("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ai_business_user_created_idx").on(t.businessId, t.userId, t.createdAt),
    index("ai_business_status_idx").on(t.businessId, t.status),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: id(),
    businessId: businessId(),
    userId: text("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary"),
    beforeData: text("before_data", { mode: "json" }).$type<unknown>(),
    afterData: text("after_data", { mode: "json" }).$type<unknown>(),
    source: text("source").notNull(),
    requestId: text("request_id"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_business_created_idx").on(t.businessId, t.createdAt),
    index("audit_business_entity_idx").on(t.businessId, t.entityType, t.entityId),
    index("audit_business_user_idx").on(t.businessId, t.userId, t.createdAt),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    businessId: businessId(),
    userId: text("user_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    dedupeKey: text("dedupe_key"),
    readAt: integer("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notif_business_created_idx").on(t.businessId, t.createdAt),
    uniqueIndex("notif_business_dedupe_uq").on(t.businessId, t.dedupeKey),
  ],
);

export const dailySummaries = sqliteTable(
  "daily_summaries",
  {
    businessId: businessId(),
    date: text("date").notNull(),
    salesPaise: integer("sales_paise").notNull(),
    orders: integer("orders").notNull(),
    grossProfitPaise: integer("gross_profit_paise").notNull(),
    expensesPaise: integer("expenses_paise").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.date] })],
);

export const appEvents = sqliteTable(
  "app_events",
  {
    id: id(),
    businessId: text("business_id"),
    userId: text("user_id"),
    name: text("name").notNull(),
    props: text("props_json", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("events_business_created_idx").on(t.businessId, t.createdAt)],
);

/** What a shop means by an ambiguous spoken word ("coke" → Coke 500ml), learned from choices. */
export const voicePreferences = sqliteTable(
  "voice_preferences",
  {
    businessId: businessId(),
    queryNorm: text("query_norm").notNull(),
    productId: text("product_id").notNull(),
    uses: integer("uses").notNull().default(1),
    lastUsedAt: integer("last_used_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.queryNorm] })],
);

/** "Request a quote" leads from the public website, worked by the platform team in /admin/leads. */
export const quoteRequests = sqliteTable(
  "quote_requests",
  {
    id: id(),
    name: text("name").notNull(),
    businessName: text("business_name").notNull(),
    mobile: text("mobile").notNull(),
    email: text("email"),
    city: text("city"),
    businessType: text("business_type"),
    outlets: text("outlets"),
    message: text("message"),
    /** NEW → CONTACTED → CONVERTED | CLOSED */
    status: text("status").notNull().default("NEW"),
    adminNotes: text("admin_notes"),
    source: text("source"),
    ip: text("ip"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("quote_requests_status_created_idx").on(t.status, t.createdAt), index("quote_requests_mobile_idx").on(t.mobile)],
);

/**
 * Per-call AI provider usage, for cost metering and budgets (AI_COST_MODEL.md).
 * One row per provider call (STT or LLM), including retries. Never stores audio or transcripts.
 */
export const aiUsageEvents = sqliteTable(
  "ai_usage_events",
  {
    id: id(),
    businessId: businessId(),
    userId: text("user_id"),
    requestId: text("request_id"),
    interactionId: text("interaction_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** stt | intent | answer | insight */
    task: text("task").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    audioMs: integer("audio_ms").notNull().default(0),
    /** Estimated cost in micro-rupees (₹ × 1,000,000) under `priceVersion`. */
    estCostMicros: integer("est_cost_micros").notNull().default(0),
    priceVersion: text("price_version").notNull(),
    latencyMs: integer("latency_ms"),
    status: text("status").notNull(),
    retryCount: integer("retry_count").notNull().default(0),
    routingReason: text("routing_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_business_created_idx").on(t.businessId, t.createdAt), index("ai_usage_task_idx").on(t.task), index("ai_usage_created_idx").on(t.createdAt)],
);

/** Per-business AI allowance and controls. Absent row = platform defaults. */
export const aiBudgets = sqliteTable("ai_budgets", {
  businessId: text("business_id").primaryKey(),
  /** Hard spend cap per calendar month in micro-rupees; null = unlimited. */
  monthlyCapMicros: integer("monthly_cap_micros"),
  /** Alert when month-to-date crosses this fraction of the cap (basis points, e.g. 8000 = 80%). */
  alertBp: integer("alert_bp").notNull().default(8000),
  /** Master off switch: when true, the LLM/STT are skipped and AI degrades gracefully. */
  killSwitch: integer("kill_switch", { mode: "boolean" }).notNull().default(false),
  updatedBy: text("updated_by"),
  updatedAt: updatedAt(),
});

/** A physical stock-count session: expected vs counted for many products, applied atomically. */
export const stockCounts = sqliteTable(
  "stock_counts",
  {
    id: id(),
    businessId: businessId(),
    status: text("status").notNull().default("COMPLETED"),
    note: text("note"),
    linesCount: integer("lines_count").notNull().default(0),
    diffCount: integer("diff_count").notNull().default(0),
    netDeltaMilli: integer("net_delta_milli").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("stock_counts_business_created_idx").on(t.businessId, t.createdAt)],
);

export const stockCountLines = sqliteTable(
  "stock_count_lines",
  {
    id: id(),
    stockCountId: text("stock_count_id").notNull(),
    businessId: businessId(),
    productId: text("product_id").notNull(),
    expectedMilli: integer("expected_milli").notNull(),
    countedMilli: integer("counted_milli").notNull(),
    diffMilli: integer("diff_milli").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("stock_count_lines_count_idx").on(t.stockCountId)],
);

/**
 * Purchase orders (optional workflow): Draft → Submitted → Approved → Partially Received →
 * Received | Cancelled. A PO plans a purchase; stock and payable change only when goods are
 * received (which creates a linked purchase). `received_milli` is a display snapshot; the
 * authoritative received quantity is the sum of linked purchase items.
 */
export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: id(),
    businessId: businessId(),
    poNumber: text("po_number").notNull(),
    supplierId: text("supplier_id"),
    status: text("status").notNull().default("DRAFT"),
    note: text("note"),
    expectedDate: text("expected_date"),
    subtotalPaise: integer("subtotal_paise").notNull().default(0),
    itemCount: integer("item_count").notNull().default(0),
    createdBy: text("created_by"),
    approvedBy: text("approved_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("purchase_orders_business_status_idx").on(t.businessId, t.status, t.createdAt)],
);

export const purchaseOrderLines = sqliteTable(
  "purchase_order_lines",
  {
    id: id(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    businessId: businessId(),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    unit: text("unit").notNull().default("pcs"),
    orderedMilli: integer("ordered_milli").notNull(),
    receivedMilli: integer("received_milli").notNull().default(0),
    unitCostPaise: integer("unit_cost_paise").notNull(),
    gstRateBp: integer("gst_rate_bp").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("purchase_order_lines_po_idx").on(t.purchaseOrderId)],
);

/**
 * POS cash-drawer shift: opening float, cash in/out during the shift, and a counted close with
 * the expected-vs-counted difference. Only one OPEN shift per business at a time.
 */
export const posShifts = sqliteTable(
  "pos_shifts",
  {
    id: id(),
    businessId: businessId(),
    status: text("status").notNull().default("OPEN"),
    openingCashPaise: integer("opening_cash_paise").notNull().default(0),
    openedBy: text("opened_by"),
    openedAt: integer("opened_at").notNull(),
    /** Set at close. */
    expectedCashPaise: integer("expected_cash_paise"),
    countedCashPaise: integer("counted_cash_paise"),
    differencePaise: integer("difference_paise"),
    note: text("note"),
    closedBy: text("closed_by"),
    closedAt: integer("closed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("pos_shifts_business_status_idx").on(t.businessId, t.status, t.openedAt)],
);

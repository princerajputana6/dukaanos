/** Domain constants shared by client and server. */

export const PERMISSIONS = [
  "sales.create",
  "sales.edit",
  "sales.delete",
  "inventory.create",
  "inventory.adjust",
  "purchase.create",
  "customer.create",
  "customer.ledger",
  "supplier.create",
  "supplier.ledger",
  "expense.create",
  "reports.view",
  "settings.manage",
  "users.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "sales.create": "Create sales",
  "sales.edit": "Edit sales",
  "sales.delete": "Reverse (undo) sales",
  "inventory.create": "Add & edit products",
  "inventory.adjust": "Adjust stock",
  "purchase.create": "Record purchases",
  "customer.create": "Add customers",
  "customer.ledger": "Record khata credit & payments",
  "supplier.create": "Add suppliers",
  "supplier.ledger": "Record supplier payments",
  "expense.create": "Record expenses",
  "reports.view": "View reports, profit & money totals",
  "settings.manage": "Manage business settings",
  "users.manage": "Manage staff & roles",
  "audit.view": "View audit log",
};

export const SYSTEM_ROLES = ["owner", "manager", "staff"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: [
    "sales.create",
    "sales.edit",
    "sales.delete",
    "inventory.create",
    "inventory.adjust",
    "purchase.create",
    "customer.create",
    "customer.ledger",
    "supplier.create",
    "supplier.ledger",
    "expense.create",
    "reports.view",
  ],
  staff: ["sales.create", "inventory.create", "customer.create", "customer.ledger"],
};

export const ROLE_LABELS: Record<SystemRole, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };

export const BUSINESS_TYPES = [
  { value: "retail", label: "Retail", emoji: "🏬" },
  { value: "grocery", label: "Grocery / Kirana", emoji: "🛒" },
  { value: "paan", label: "Paan shop", emoji: "🌿" },
  { value: "salon", label: "Salon", emoji: "💇" },
  { value: "cafe", label: "Cafe / Tea shop", emoji: "☕" },
  { value: "stationery", label: "Stationery", emoji: "✏️" },
  { value: "electronics", label: "Electronics", emoji: "🔌" },
  { value: "garments", label: "Garments", emoji: "👕" },
  { value: "distributor", label: "Distributor", emoji: "🚚" },
  { value: "other", label: "Other", emoji: "🏪" },
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number]["value"];
export const BUSINESS_TYPE_VALUES = BUSINESS_TYPES.map((b) => b.value) as [BusinessType, ...BusinessType[]];

export const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "CREDIT", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  CREDIT: "Credit (Udhaar)",
  OTHER: "Other",
};
/** Methods that move money immediately (i.e. not credit). */
export const SETTLEMENT_METHODS = ["CASH", "UPI", "CARD", "OTHER"] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const DEFAULT_EXPENSE_CATEGORIES = ["Rent", "Electricity", "Salary", "Transport", "Maintenance", "Marketing", "Other"] as const;

export const MOVEMENT_TYPES = ["OPENING", "PURCHASE", "SALE", "ADJUSTMENT", "RETURN", "DAMAGE", "REVERSAL"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_LABELS: Record<MovementType, string> = {
  OPENING: "Opening stock",
  PURCHASE: "Purchase",
  SALE: "Sale",
  ADJUSTMENT: "Adjustment",
  RETURN: "Return",
  DAMAGE: "Damage",
  REVERSAL: "Reversal",
};
/** Manual stock adjustment reasons exposed in the UI. */
export const ADJUSTMENT_TYPES = ["ADJUSTMENT", "RETURN", "DAMAGE"] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const AUDIT_SOURCES = ["WEB", "VOICE", "IMPORT", "SYSTEM"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const CUSTOMER_TXN_TYPES = ["SALE_CREDIT", "CREDIT", "PAYMENT", "ADJUSTMENT", "REVERSAL"] as const;
export type CustomerTxnType = (typeof CUSTOMER_TXN_TYPES)[number];
export const SUPPLIER_TXN_TYPES = ["PURCHASE_CREDIT", "PAYMENT", "ADJUSTMENT", "REVERSAL"] as const;
export type SupplierTxnType = (typeof SUPPLIER_TXN_TYPES)[number];

export const TXN_STATUSES = ["COMPLETED", "REVERSED"] as const;
export type TxnStatus = (typeof TXN_STATUSES)[number];

export const PAYMENT_STATUSES = ["PAID", "PARTIAL", "UNPAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PRODUCT_UNITS = ["pcs", "kg", "g", "l", "ml", "pack", "box", "dozen", "bottle", "packet", "m"] as const;

/** Common GST slabs in basis points. */
export const GST_RATES_BP = [0, 25, 300, 500, 1200, 1800, 2800, 4000] as const;

export const GST_REGISTRATION = ["UNREGISTERED", "REGISTERED", "COMPOSITION"] as const;
export type GstRegistration = (typeof GST_REGISTRATION)[number];

/** Indian states & UTs with GST state codes. */
export const INDIAN_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu & Kashmir" }, { code: "02", name: "Himachal Pradesh" }, { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" }, { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" }, { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" }, { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" }, { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" }, { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" }, { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" }, { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra & Nagar Haveli and Daman & Diu" }, { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" }, { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" }, { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman & Nicobar" }, { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

export const FEATURE_FLAGS = ["VOICE_ENABLED", "AI_INSIGHTS_ENABLED", "OFFLINE_ENABLED", "GST_ENABLED", "REPORTS_ENABLED"] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;

export type StockState = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
export function stockState(currentMilli: number, thresholdMilli: number): StockState {
  if (currentMilli <= 0) return "OUT_OF_STOCK";
  if (currentMilli <= thresholdMilli) return "LOW_STOCK";
  return "IN_STOCK";
}

// ─── Platform: tenants, branches & licensing ─────────────────────────────────

export const PLATFORM_ROLES = ["SUPER_ADMIN"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const LICENSE_PLANS = {
  TRIAL: { label: "Free trial", maxBranches: 1, maxUsers: 3, days: 30 },
  BASIC: { label: "Basic", maxBranches: 1, maxUsers: 5, days: 365 },
  PRO: { label: "Pro", maxBranches: 5, maxUsers: 20, days: 365 },
  ENTERPRISE: { label: "Enterprise", maxBranches: 50, maxUsers: 200, days: 365 },
} as const;
export type LicensePlan = keyof typeof LICENSE_PLANS;
export const LICENSE_PLAN_KEYS = Object.keys(LICENSE_PLANS) as [LicensePlan, ...LicensePlan[]];

export const LICENSE_STATUSES = ["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

/** The status that actually applies today (an ACTIVE/TRIAL licence past its end date is EXPIRED). */
export function effectiveLicenseStatus(l: { status: string; validUntil: string | null }, todayIst: string): LicenseStatus {
  if (l.status === "SUSPENDED" || l.status === "CANCELLED" || l.status === "EXPIRED") return l.status;
  if (l.validUntil && l.validUntil < todayIst) return "EXPIRED";
  return l.status === "TRIAL" ? "TRIAL" : "ACTIVE";
}

/** Shops on an unusable licence (or suspended) stay readable but cannot record anything. */
export function licenseAllowsWrites(status: LicenseStatus): boolean {
  return status === "TRIAL" || status === "ACTIVE";
}

export const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = {
  TRIAL: "Trial",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

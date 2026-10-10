/**
 * Client-side response types, derived from server service return types (type-only imports:
 * no server code is bundled). JSON turns Dates into strings, but we only use numbers/strings.
 */
import type * as ai from "@/server/ai/assistant";
import type * as auditSvc from "@/server/services/audit";
import type * as customers from "@/server/services/customers";
import type * as expenses from "@/server/services/expenses";
import type * as inventory from "@/server/services/inventory";
import type * as members from "@/server/services/members";
import type * as notif from "@/server/services/notifications";
import type * as products from "@/server/services/products";
import type * as purchases from "@/server/services/purchases";
import type * as reports from "@/server/services/reports";
import type * as sales from "@/server/services/sales";
import type * as search from "@/server/services/search";
import type * as suppliers from "@/server/services/suppliers";

type R<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

export type ProductList = R<typeof products.listProducts>;
export type ProductListItem = ProductList["items"][number];
export type ProductDetail = R<typeof products.getProductDetail>;
export type Category = R<typeof products.listCategories>[number];
export type ImportReport = products.ImportReport;

export type InventorySummary = R<typeof inventory.inventorySummary>;
export type LowStockItem = R<typeof inventory.lowStockProducts>[number];
export type MovementList = R<typeof inventory.listMovements>;
export type Movement = MovementList["items"][number];

export type SaleList = R<typeof sales.listSales>;
export type SaleListItem = SaleList["items"][number];
export type SaleDetail = R<typeof sales.getSaleDetail>;
export type SaleResult = sales.SaleResult;
export type SalePreview = sales.SalePreview;

export type PurchaseList = R<typeof purchases.listPurchases>;
export type PurchaseDetail = R<typeof purchases.getPurchaseDetail>;
export type PurchaseResult = purchases.PurchaseResult;

export type CustomerList = R<typeof customers.listCustomers>;
export type CustomerListItem = CustomerList["items"][number];
export type CustomerDetail = R<typeof customers.getCustomerDetail>;
export type LedgerEntry = CustomerDetail["ledger"][number];

export type SupplierList = R<typeof suppliers.listSuppliers>;
export type SupplierDetail = R<typeof suppliers.getSupplierDetail>;

export type ExpenseList = R<typeof expenses.listExpenses>;
export type ExpenseCategory = R<typeof expenses.listExpenseCategories>[number];

export type Dashboard = R<typeof reports.dashboard>;
export type SalesReport = R<typeof reports.salesReport>;
export type ProfitReport = R<typeof reports.profitReport>;
export type ExpensesReport = R<typeof reports.expensesReport>;
export type InventoryValuation = R<typeof reports.inventoryValuation>;
export type GstSummary = R<typeof reports.gstSummary>;
export type OutstandingRow = R<typeof reports.customerOutstanding>[number];
export type TopProduct = R<typeof reports.topProducts>[number];

export type NotificationList = R<typeof notif.listNotifications>;
export type AuditList = R<typeof auditSvc.listAudit>;
export type AuditItem = AuditList["items"][number];
export type Member = R<typeof members.listMembers>[number];
export type Role = R<typeof members.listRoles>[number];
export type SearchResults = R<typeof search.globalSearch>;

export type AssistantResponse = ai.AssistantResponse;

import type * as adminSvc from "@/server/services/admin";
import type * as branchSvc from "@/server/services/branches";
export type AdminOverview = R<typeof adminSvc.overview>;
export type AdminTenantList = R<typeof adminSvc.listTenants>;
export type AdminTenantRow = AdminTenantList["items"][number];
export type AdminTenantDetail = R<typeof adminSvc.getTenant>;
export type AdminShopList = R<typeof adminSvc.listShops>;
export type AdminShopRow = AdminShopList["items"][number];
export type AdminAgency = R<typeof adminSvc.listAgencies>[number];
export type AdminUserList = R<typeof adminSvc.listUsers>;
export type AdminUserRow = AdminUserList["items"][number];
export type AdminAuditList = R<typeof adminSvc.listPlatformAudit>;
export type AdminCreateShopResult = adminSvc.CreateShopResult;
export type BranchList = R<typeof branchSvc.listBranches>;

import { z } from "zod";
import { createExpenseCategorySchema, createExpenseSchema, listExpensesSchema } from "@/schemas/expenses";
import { addMemberSchema, listAuditSchema, resetMemberPasswordSchema, roleSchema, searchSchema, updateMemberSchema } from "@/schemas/admin";
import { reverseSchema } from "@/schemas/parties";
import { dateRangeSchema } from "@/schemas/common";
import { listAudit } from "@/server/services/audit";
import * as expensesSvc from "@/server/services/expenses";
import * as members from "@/server/services/members";
import * as notif from "@/server/services/notifications";
import * as reports from "@/server/services/reports";
import { globalSearch } from "@/server/services/search";
import { AppError } from "@/server/lib/errors";
import { body, csv, idempotencyKey, ok, query } from "../respond";
import { bizRouter, requirePerm } from "../middleware";

export const expenseRoutes = bizRouter()
  .use("*", requirePerm("expense.create"))
  .get("/", async (c) => ok(c, await expensesSvc.listExpenses(c.get("ctx"), query(c, listExpensesSchema))))
  .post("/", async (c) => ok(c, await expensesSvc.createExpense(c.get("ctx"), await body(c, createExpenseSchema), idempotencyKey(c)), 201))
  .get("/categories", async (c) => ok(c, await expensesSvc.listExpenseCategories(c.get("ctx"))))
  .post("/categories", async (c) => ok(c, await expensesSvc.createExpenseCategory(c.get("ctx"), (await body(c, createExpenseCategorySchema)).name), 201))
  .get("/export", async (c) => {
    const r = query(c, dateRangeSchema);
    return csv(`expenses-${r.from}-${r.to}.csv`, await expensesSvc.exportExpensesCsv(c.get("ctx"), r.from, r.to));
  })
  .post("/:id/reverse", async (c) => ok(c, await expensesSvc.reverseExpense(c.get("ctx"), c.req.param("id"), (await body(c, reverseSchema)).reason, idempotencyKey(c))));

const REPORT_KINDS = ["sales", "profit", "expenses", "top-products", "inventory", "low-stock", "customer-outstanding", "supplier-outstanding", "gst"] as const;

export const reportRoutes = bizRouter()
  .get("/dashboard", async (c) => ok(c, await reports.dashboard(c.get("ctx"))))
  .use("/*", async (c, next) => {
    if (c.req.path.endsWith("/dashboard")) return next();
    if (c.env.FLAG_REPORTS_ENABLED === "false") throw new AppError("FEATURE_DISABLED", "Reports are turned off.");
    return requirePerm("reports.view")(c, next);
  })
  .get("/sales", async (c) => ok(c, await reports.salesReport(c.get("ctx"), query(c, dateRangeSchema))))
  .get("/profit", async (c) => ok(c, await reports.profitReport(c.get("ctx"), query(c, dateRangeSchema))))
  .get("/expenses", async (c) => ok(c, await reports.expensesReport(c.get("ctx"), query(c, dateRangeSchema))))
  .get("/top-products", async (c) => {
    const r = query(c, dateRangeSchema);
    return ok(c, await reports.topProducts(c.get("ctx"), r, 20));
  })
  .get("/inventory", async (c) => ok(c, await reports.inventoryValuation(c.get("ctx"))))
  .get("/customer-outstanding", async (c) => ok(c, await reports.customerOutstanding(c.get("ctx"))))
  .get("/supplier-outstanding", async (c) => ok(c, await reports.supplierOutstanding(c.get("ctx"))))
  .get("/gst", async (c) => ok(c, await reports.gstSummary(c.get("ctx"), query(c, dateRangeSchema))))
  .get("/export/:kind", async (c) => {
    const kind = z.enum(REPORT_KINDS).safeParse(c.req.param("kind"));
    if (!kind.success) throw new AppError("NOT_FOUND", "Unknown report.");
    const r = query(c, dateRangeSchema);
    const out = await reports.reportCsv(c.get("ctx"), kind.data, r);
    return csv(out.filename, out.csv);
  });

export const notificationRoutes = bizRouter()
  .get("/", async (c) => {
    const q = query(c, z.object({ cursor: z.string().max(20).optional(), unread: z.enum(["1", "0"]).optional() }));
    return ok(c, await notif.listNotifications(c.get("ctx"), { cursor: q.cursor, unreadOnly: q.unread === "1" }));
  })
  .get("/unread-count", async (c) => ok(c, { count: await notif.unreadCount(c.get("ctx")) }))
  .post("/read-all", async (c) => ok(c, await notif.markRead(c.get("ctx"), "all")))
  .post("/:id/read", async (c) => ok(c, await notif.markRead(c.get("ctx"), c.req.param("id"))));

export const auditRoutes = bizRouter().get("/", requirePerm("audit.view"), async (c) => ok(c, await listAudit(c.get("ctx"), query(c, listAuditSchema))));

export const searchRoutes = bizRouter().get("/", async (c) => ok(c, await globalSearch(c.get("ctx"), query(c, searchSchema).q)));

export const teamRoutes = bizRouter()
  .get("/roles", async (c) => ok(c, await members.listRoles(c.get("ctx"))))
  .use("*", requirePerm("users.manage"))
  .get("/members", async (c) => ok(c, await members.listMembers(c.get("ctx"))))
  .post("/members", async (c) => ok(c, await members.addMember(c.get("ctx"), await body(c, addMemberSchema)), 201))
  .patch("/members/:id", async (c) => ok(c, await members.updateMember(c.get("ctx"), c.req.param("id"), await body(c, updateMemberSchema))))
  .post("/members/:id/reset-password", async (c) =>
    ok(c, await members.resetMemberPassword(c.get("ctx"), c.req.param("id"), (await body(c, resetMemberPasswordSchema)).password)),
  )
  .post("/roles", async (c) => ok(c, await members.saveRole(c.get("ctx"), await body(c, roleSchema)), 201))
  .patch("/roles/:id", async (c) => ok(c, await members.saveRole(c.get("ctx"), await body(c, roleSchema), c.req.param("id"))));

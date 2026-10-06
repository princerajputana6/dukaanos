import { createSaleSchema, createPurchaseSchema, listPurchasesSchema, listSalesSchema } from "@/schemas/sales";
import { reverseSchema } from "@/schemas/parties";
import { dateRangeSchema } from "@/schemas/common";
import * as purchasesSvc from "@/server/services/purchases";
import * as salesSvc from "@/server/services/sales";
import { body, csv, idempotencyKey, ok, query } from "../respond";
import { bizRouter, requirePerm } from "../middleware";

export const saleRoutes = bizRouter()
  .get("/", async (c) => ok(c, await salesSvc.listSales(c.get("ctx"), query(c, listSalesSchema))))
  .post("/", requirePerm("sales.create"), async (c) => ok(c, await salesSvc.createSale(c.get("ctx"), await body(c, createSaleSchema), idempotencyKey(c)), 201))
  .post("/preview", requirePerm("sales.create"), async (c) => ok(c, (await salesSvc.previewSale(c.get("ctx"), await body(c, createSaleSchema))).preview))
  .get("/export", requirePerm("reports.view"), async (c) => {
    const r = query(c, dateRangeSchema);
    return csv(`sales-${r.from}-${r.to}.csv`, await salesSvc.exportSalesCsv(c.get("ctx"), r.from, r.to));
  })
  .get("/:id", async (c) => ok(c, await salesSvc.getSaleDetail(c.get("ctx"), c.req.param("id"))))
  .post("/:id/reverse", requirePerm("sales.delete"), async (c) =>
    ok(c, await salesSvc.reverseSale(c.get("ctx"), c.req.param("id"), (await body(c, reverseSchema)).reason, idempotencyKey(c))),
  );

export const purchaseRoutes = bizRouter()
  .use("*", requirePerm("purchase.create"))
  .get("/", async (c) => ok(c, await purchasesSvc.listPurchases(c.get("ctx"), query(c, listPurchasesSchema))))
  .post("/", async (c) => ok(c, await purchasesSvc.createPurchase(c.get("ctx"), await body(c, createPurchaseSchema), idempotencyKey(c)), 201))
  .get("/export", async (c) => {
    const r = query(c, dateRangeSchema);
    return csv(`purchases-${r.from}-${r.to}.csv`, await purchasesSvc.exportPurchasesCsv(c.get("ctx"), r.from, r.to));
  })
  .get("/:id", async (c) => ok(c, await purchasesSvc.getPurchaseDetail(c.get("ctx"), c.req.param("id"))))
  .post("/:id/reverse", requirePerm("sales.delete"), async (c) =>
    ok(c, await purchasesSvc.reversePurchase(c.get("ctx"), c.req.param("id"), (await body(c, reverseSchema)).reason, idempotencyKey(c))),
  );

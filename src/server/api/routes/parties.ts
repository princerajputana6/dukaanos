import { z } from "zod";
import {
  createCustomerSchema,
  createSupplierSchema,
  customerCreditSchema,
  ledgerAdjustmentSchema,
  listPartiesSchema,
  partyPaymentSchema,
  reverseSchema,
  updateCustomerSchema,
  updateSupplierSchema,
} from "@/schemas/parties";
import { todayIst } from "@/lib/dates";
import * as customersSvc from "@/server/services/customers";
import * as suppliersSvc from "@/server/services/suppliers";
import { body, csv, idempotencyKey, ok, query } from "../respond";
import { bizRouter, requirePerm } from "../middleware";

const pageSchema = z.object({ cursor: z.string().max(20).optional() });

export const customerRoutes = bizRouter()
  .get("/", async (c) => ok(c, await customersSvc.listCustomers(c.get("ctx"), query(c, listPartiesSchema))))
  .post("/", requirePerm("customer.create"), async (c) => ok(c, await customersSvc.createCustomer(c.get("ctx"), await body(c, createCustomerSchema), idempotencyKey(c)), 201))
  .get("/export", requirePerm("reports.view"), async (c) => csv(`customers-${todayIst()}.csv`, await customersSvc.exportCustomersCsv(c.get("ctx"))))
  .get("/:id", async (c) => ok(c, await customersSvc.getCustomerDetail(c.get("ctx"), c.req.param("id"), query(c, pageSchema))))
  .patch("/:id", requirePerm("customer.create"), async (c) => ok(c, await customersSvc.updateCustomer(c.get("ctx"), c.req.param("id"), await body(c, updateCustomerSchema))))
  .post("/:id/payment", requirePerm("customer.ledger"), async (c) =>
    ok(c, await customersSvc.recordCustomerPayment(c.get("ctx"), c.req.param("id"), await body(c, partyPaymentSchema), idempotencyKey(c)), 201),
  )
  .post("/:id/credit", requirePerm("customer.ledger"), async (c) =>
    ok(c, await customersSvc.recordCustomerCredit(c.get("ctx"), c.req.param("id"), await body(c, customerCreditSchema), idempotencyKey(c)), 201),
  )
  .post("/:id/adjust", requirePerm("customer.ledger"), async (c) =>
    ok(c, await customersSvc.adjustCustomerBalance(c.get("ctx"), c.req.param("id"), await body(c, ledgerAdjustmentSchema), idempotencyKey(c)), 201),
  )
  .post("/:id/entries/:entryId/reverse", requirePerm("customer.ledger"), async (c) =>
    ok(c, await customersSvc.reverseCustomerEntry(c.get("ctx"), c.req.param("id"), c.req.param("entryId"), (await body(c, reverseSchema)).reason, idempotencyKey(c))),
  );

export const supplierRoutes = bizRouter()
  .get("/", requirePerm("supplier.create"), async (c) => ok(c, await suppliersSvc.listSuppliers(c.get("ctx"), query(c, listPartiesSchema))))
  .post("/", requirePerm("supplier.create"), async (c) => ok(c, await suppliersSvc.createSupplier(c.get("ctx"), await body(c, createSupplierSchema), idempotencyKey(c)), 201))
  .get("/export", requirePerm("reports.view"), async (c) => csv(`suppliers-${todayIst()}.csv`, await suppliersSvc.exportSuppliersCsv(c.get("ctx"))))
  .get("/:id", requirePerm("supplier.create"), async (c) => ok(c, await suppliersSvc.getSupplierDetail(c.get("ctx"), c.req.param("id"), query(c, pageSchema))))
  .patch("/:id", requirePerm("supplier.create"), async (c) => ok(c, await suppliersSvc.updateSupplier(c.get("ctx"), c.req.param("id"), await body(c, updateSupplierSchema))))
  .post("/:id/payment", requirePerm("supplier.ledger"), async (c) =>
    ok(c, await suppliersSvc.recordSupplierPayment(c.get("ctx"), c.req.param("id"), await body(c, partyPaymentSchema), idempotencyKey(c)), 201),
  )
  .post("/:id/adjust", requirePerm("supplier.ledger"), async (c) =>
    ok(c, await suppliersSvc.adjustSupplierBalance(c.get("ctx"), c.req.param("id"), await body(c, ledgerAdjustmentSchema), idempotencyKey(c)), 201),
  )
  .post("/:id/entries/:entryId/reverse", requirePerm("supplier.ledger"), async (c) =>
    ok(c, await suppliersSvc.reverseSupplierEntry(c.get("ctx"), c.req.param("id"), c.req.param("entryId"), (await body(c, reverseSchema)).reason, idempotencyKey(c))),
  );

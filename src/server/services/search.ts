import { and, desc, eq, like, or } from "drizzle-orm";
import { escapeLike } from "@/lib/text";
import { customers, products, sales, suppliers } from "@/server/db/schema";
import type { ServiceContext } from "./context";
import { searchCondition } from "./products";

/** Global search across products, customers, suppliers and bills (English/Hindi/Hinglish). */
export async function globalSearch(ctx: ServiceContext, q: string) {
  const code = q.trim();
  const pCond = searchCondition(products.searchText, q);
  const cCond = searchCondition(customers.searchText, q);
  const sCond = searchCondition(suppliers.searchText, q);
  const [prods, custs, supps, bills] = await Promise.all([
    ctx.db
      .select({ id: products.id, name: products.name, unit: products.unit, stockMilli: products.currentStockMilli, sellingPricePaise: products.sellingPricePaise, trackStock: products.trackStock })
      .from(products)
      .where(and(eq(products.businessId, ctx.businessId), eq(products.isActive, true), or(eq(products.barcode, code), eq(products.sku, code), pCond)))
      .limit(6),
    cCond
      ? ctx.db
          .select({ id: customers.id, name: customers.name, phone: customers.phone, balancePaise: customers.balancePaise })
          .from(customers)
          .where(and(eq(customers.businessId, ctx.businessId), eq(customers.isActive, true), cCond))
          .limit(5)
      : Promise.resolve([]),
    sCond && ctx.permissions.has("supplier.create")
      ? ctx.db
          .select({ id: suppliers.id, name: suppliers.name, company: suppliers.company, balancePaise: suppliers.balancePaise })
          .from(suppliers)
          .where(and(eq(suppliers.businessId, ctx.businessId), eq(suppliers.isActive, true), sCond))
          .limit(5)
      : Promise.resolve([]),
    /\d/.test(code)
      ? ctx.db
          .select({ id: sales.id, invoiceNumber: sales.invoiceNumber, totalPaise: sales.totalPaise, txnDate: sales.txnDate, status: sales.status })
          .from(sales)
          .where(and(eq(sales.businessId, ctx.businessId), like(sales.invoiceNumber, `%${escapeLike(code.toUpperCase())}%`)))
          .orderBy(desc(sales.createdAt))
          .limit(5)
      : Promise.resolve([]),
  ]);
  return { products: prods, customers: custs, suppliers: supps, sales: bills };
}

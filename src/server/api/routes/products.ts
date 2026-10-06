import { z } from "zod";
import { adjustStockSchema, listMovementsSchema } from "@/schemas/inventory";
import { createCategorySchema, createProductSchema, importProductsSchema, listProductsSchema, updateProductSchema } from "@/schemas/products";
import { AppError } from "@/server/lib/errors";
import * as inventory from "@/server/services/inventory";
import * as productsSvc from "@/server/services/products";
import { todayIst } from "@/lib/dates";
import { body, csv, idempotencyKey, ok, query } from "../respond";
import { bizRouter, requirePerm } from "../middleware";

export const productRoutes = bizRouter()
  .get("/", async (c) => ok(c, await productsSvc.listProducts(c.get("ctx"), query(c, listProductsSchema))))
  .post("/", requirePerm("inventory.create"), async (c) => ok(c, await productsSvc.createProduct(c.get("ctx"), await body(c, createProductSchema), idempotencyKey(c)), 201))
  .get("/categories", async (c) => ok(c, await productsSvc.listCategories(c.get("ctx"))))
  .post("/categories", requirePerm("inventory.create"), async (c) => ok(c, await productsSvc.createCategory(c.get("ctx"), (await body(c, createCategorySchema)).name), 201))
  .get("/export", async (c) => csv(`products-${todayIst()}.csv`, await productsSvc.exportProductsCsv(c.get("ctx"))))
  .get("/import/template", () =>
    csv(
      "dukaanos-products-template.csv",
      `${productsSvc.PRODUCT_CSV_HEADER.join(",")}\r\nCoke 500ml,,8901234567890,Cold Drinks,Coca-Cola,bottle,33,40,40,40,2202,24,12,Coke|कोक\r\n`,
    ),
  )
  .post("/import", requirePerm("inventory.create"), async (c) => {
    const input = await body(c, importProductsSchema);
    return ok(c, await productsSvc.importProductsCsv(c.get("ctx"), input.csv, input.dryRun));
  })
  .post("/samples", requirePerm("inventory.create"), async (c) => ok(c, await productsSvc.addSampleProducts(c.get("ctx")), 201))
  .get("/:id", async (c) => ok(c, await productsSvc.getProductDetail(c.get("ctx"), c.req.param("id"))))
  .patch("/:id", requirePerm("inventory.create"), async (c) => ok(c, await productsSvc.updateProduct(c.get("ctx"), c.req.param("id"), await body(c, updateProductSchema))))
  .post("/:id/image", requirePerm("inventory.create"), async (c) => {
    const files = c.env.FILES;
    if (!files) throw new AppError("FEATURE_DISABLED", "Image storage is not configured.");
    const ctx = c.get("ctx");
    const product = await productsSvc.getProductRow(ctx, c.req.param("id"));
    const form = await c.req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "Choose an image.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new AppError("VALIDATION_ERROR", "Use a JPG, PNG or WebP image.");
    if (file.size > 2 * 1024 * 1024) throw new AppError("PAYLOAD_TOO_LARGE", "Image must be under 2 MB.");
    const key = `${ctx.businessId}/products/${product.id}-${ctx.now}.${file.type.split("/")[1]}`;
    await files.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    await productsSvc.setProductImage(ctx, product.id, key);
    return ok(c, { imageKey: key });
  });

export const inventoryRoutes = bizRouter()
  .get("/", async (c) => ok(c, await inventory.inventorySummary(c.get("ctx"))))
  .get("/low-stock", async (c) => ok(c, await inventory.lowStockProducts(c.get("ctx"))))
  .get("/movements", async (c) => ok(c, await inventory.listMovements(c.get("ctx"), query(c, listMovementsSchema))))
  .post("/adjust", requirePerm("inventory.adjust"), async (c) => ok(c, await inventory.adjustStock(c.get("ctx"), await body(c, adjustStockSchema), idempotencyKey(c)), 201));

/** Serves business-scoped files from R2 (auth + business prefix enforced). */
export const fileRoutes = bizRouter().get("/*", async (c) => {
  const files = c.env.FILES;
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/files\//, ""));
  const ctx = c.get("ctx");
  if (!files || !z.string().max(300).safeParse(key).success || !key.startsWith(`${ctx.businessId}/`) || key.includes("..")) {
    throw new AppError("NOT_FOUND", "File not found.");
  }
  const obj = await files.get(key);
  if (!obj) throw new AppError("NOT_FOUND", "File not found.");
  return new Response(obj.body as unknown as ReadableStream, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, max-age=86400" },
  });
});

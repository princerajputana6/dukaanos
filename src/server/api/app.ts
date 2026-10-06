import { Hono } from "hono";
import { AppError, toErrorBody } from "@/server/lib/errors";
import { errorFields } from "@/server/lib/logger";
import { listUserBusinesses } from "@/server/services/auth";
import { getBusinessBundle } from "@/server/services/business";
import { csrf, loadSession, requestContext, requireUser } from "./middleware";
import { ok } from "./respond";
import { authRoutes } from "./routes/auth";
import { aiRoutes } from "./routes/ai";
import { businessRoutes } from "./routes/business";
import { auditRoutes, expenseRoutes, notificationRoutes, reportRoutes, searchRoutes, teamRoutes } from "./routes/misc";
import { customerRoutes, supplierRoutes } from "./routes/parties";
import { fileRoutes, inventoryRoutes, productRoutes } from "./routes/products";
import { purchaseRoutes, saleRoutes } from "./routes/sales";
import type { AppEnv } from "./types";

export function createApp() {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", requestContext);
  app.use("*", async (c, next) => {
    await next();
    c.header("cache-control", c.res.headers.get("cache-control") ?? "no-store");
    c.header("x-content-type-options", "nosniff");
  });
  app.use("*", csrf);
  app.use("*", loadSession);

  app.get("/health", (c) => ok(c, { status: "ok", env: c.env.ENVIRONMENT }));
  app.route("/auth", authRoutes);

  app.get("/me", requireUser, async (c) => {
    const s = c.get("session")!;
    const [businesses, bundle] = await Promise.all([
      listUserBusinesses(c.get("db"), s.user.id),
      s.membership ? getBusinessBundle(c.get("db"), c.env, s.membership.businessId) : Promise.resolve(null),
    ]);
    return ok(c, {
      user: s.user,
      membership: s.membership,
      businesses,
      ...(bundle ?? { business: null, settings: null, gst: null, flags: null }),
    });
  });

  // Business routes: each router is created with `bizRouter()`, which applies requireBusiness
  // to its own prefix only (Hono merges "*" middleware into the parent path).
  app.route("/business", businessRoutes);
  app.route("/products", productRoutes);
  app.route("/inventory", inventoryRoutes);
  app.route("/files", fileRoutes);
  app.route("/sales", saleRoutes);
  app.route("/purchases", purchaseRoutes);
  app.route("/customers", customerRoutes);
  app.route("/suppliers", supplierRoutes);
  app.route("/expenses", expenseRoutes);
  app.route("/reports", reportRoutes);
  app.route("/notifications", notificationRoutes);
  app.route("/audit", auditRoutes);
  app.route("/search", searchRoutes);
  app.route("/team", teamRoutes);
  app.route("/ai", aiRoutes);

  app.notFound((c) => c.json(toErrorBody(new AppError("NOT_FOUND", "Endpoint not found.")), 404));
  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.status >= 500) c.get("logger")?.error("app error", { code: err.code, ...errorFields(err) });
      return c.json(toErrorBody(err), err.status as 400);
    }
    c.get("logger")?.error("unhandled error", errorFields(err));
    return c.json(toErrorBody(new AppError("INTERNAL_ERROR", "Something went wrong. Please try again.")), 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

let singleton: App | null = null;
export function getApp(): App {
  singleton ??= createApp();
  return singleton;
}

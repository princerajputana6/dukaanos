import { Hono } from "hono";
import { quoteRequestSchema } from "@/schemas/marketing";
import { createQuoteRequest } from "@/server/services/leads";
import { body, ok } from "../respond";
import { rateLimit } from "../middleware";
import type { AppEnv } from "../types";

/** Unauthenticated website endpoints. */
export const publicRoutes = new Hono<AppEnv>().post("/quote", rateLimit("AUTH_LIMITER", "ip"), async (c) => {
  const input = await body(c, quoteRequestSchema);
  const res = await createQuoteRequest(c.get("db"), input, { ip: c.get("ip") ?? null, now: c.get("now") });
  if (res.id) c.get("logger").info("quote request received", { leadId: res.id });
  return ok(c, { received: true }, 201);
});

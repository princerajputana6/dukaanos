import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { AppError } from "@/server/lib/errors";
import type { AppEnv } from "./types";

export function ok<T>(c: Context<AppEnv>, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true as const, data }, status);
}

function zodDetails(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

function firstMessage(error: z.ZodError): string {
  const i = error.issues[0];
  if (!i) return "Invalid input.";
  return i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message;
}

const MAX_JSON_BYTES = 512 * 1024;

/** Parses & validates a JSON body. Never trust client input. */
export async function body<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > MAX_JSON_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Request is too large.");
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", firstMessage(parsed.error), zodDetails(parsed.error));
  return parsed.data;
}

export function query<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", firstMessage(parsed.error), zodDetails(parsed.error));
  return parsed.data;
}

export function idempotencyKey(c: Context<AppEnv>): string | undefined {
  return c.req.header("idempotency-key") ?? undefined;
}

/** CSV download response. */
export function csv(filename: string, content: string) {
  return new Response(content, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "cache-control": "no-store",
    },
  });
}

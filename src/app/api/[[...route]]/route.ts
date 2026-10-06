import { env } from "cloudflare:workers";
import { getApp } from "@/server/api/app";

/** All /api/* traffic is handled by the Hono app (src/server/api). */
async function handle(request: Request): Promise<Response> {
  return getApp().fetch(request, env);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;

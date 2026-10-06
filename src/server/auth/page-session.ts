import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { resolveSession, SESSION_COOKIE, type SessionUser } from "./session";

/** Resolves the session for server components/layouts (read-only use). */
export async function getPageSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSession(getDb(env.DB), token, Date.now());
}

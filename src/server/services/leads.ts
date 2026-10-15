/**
 * Website leads ("Request a quote"). Public submissions are validated and rate limited at the
 * route; the platform team works them from the super admin console.
 */
import { and, desc, eq, gte, like, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { newId } from "@/lib/ids";
import { escapeLike } from "@/lib/text";
import type { quoteRequestSchema, updateLeadSchema } from "@/schemas/marketing";
import type { Db } from "@/server/db/client";
import { platformAuditLogs, quoteRequests } from "@/server/db/schema";
import { notFound } from "@/server/lib/errors";
import type { AdminContext } from "./admin";

/** Same mobile within this window updates the open lead instead of creating duplicates. */
const DEDUPE_WINDOW_MS = 24 * 3_600_000;

export async function createQuoteRequest(db: Db, input: z.output<typeof quoteRequestSchema>, meta: { ip: string | null; now: number }) {
  // Honeypot filled → pretend success, store nothing.
  if (input.website) return { id: null, received: true };
  const fields = {
    name: input.name,
    businessName: input.businessName,
    mobile: input.mobile,
    email: input.email ?? null,
    city: input.city ?? null,
    businessType: input.businessType ?? null,
    outlets: input.outlets,
    message: input.message ?? null,
    source: input.source ?? "website",
    ip: meta.ip,
  };
  const recent = await db
    .select({ id: quoteRequests.id })
    .from(quoteRequests)
    .where(and(eq(quoteRequests.mobile, input.mobile), eq(quoteRequests.status, "NEW"), gte(quoteRequests.createdAt, meta.now - DEDUPE_WINDOW_MS)))
    .get();
  if (recent) {
    await db.update(quoteRequests).set({ ...fields, updatedAt: meta.now }).where(eq(quoteRequests.id, recent.id));
    return { id: recent.id, received: true };
  }
  const id = newId(meta.now);
  await db.insert(quoteRequests).values({ id, ...fields, status: "NEW", createdAt: meta.now, updatedAt: meta.now });
  return { id, received: true };
}

export async function listLeads(ctx: AdminContext, input: { q?: string; status?: string; cursor?: string; limit: number }) {
  const offset = Math.max(0, Number(input.cursor ?? 0) || 0);
  const conds: SQL[] = [];
  if (input.status) conds.push(eq(quoteRequests.status, input.status));
  if (input.q) {
    const p = `%${escapeLike(input.q)}%`;
    conds.push(or(like(quoteRequests.name, p), like(quoteRequests.businessName, p), like(quoteRequests.mobile, p), like(quoteRequests.city, p))!);
  }
  const [rows, counts] = await Promise.all([
    ctx.db
      .select()
      .from(quoteRequests)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(quoteRequests.createdAt))
      .limit(input.limit + 1)
      .offset(offset),
    ctx.db.select({ status: quoteRequests.status, n: sql<number>`count(*)` }).from(quoteRequests).groupBy(quoteRequests.status),
  ]);
  return {
    items: rows.slice(0, input.limit).map(({ ip: _ip, ...r }) => r),
    nextCursor: rows.length > input.limit ? String(offset + input.limit) : null,
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])) as Record<string, number>,
  };
}

export async function updateLead(ctx: AdminContext, id: string, input: z.output<typeof updateLeadSchema>) {
  const lead = await ctx.db.select().from(quoteRequests).where(eq(quoteRequests.id, id)).get();
  if (!lead) throw notFound("Lead");
  const patch = { ...(input.status ? { status: input.status } : {}), ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}), updatedAt: ctx.now };
  await ctx.db.batch([
    ctx.db.update(quoteRequests).set(patch).where(eq(quoteRequests.id, id)),
    ctx.db.insert(platformAuditLogs).values({
      id: newId(ctx.now),
      actorUserId: ctx.actorUserId,
      action: "LEAD_UPDATED",
      targetType: "lead",
      targetId: id,
      summary: `Lead ${lead.businessName}: ${input.status ? `${lead.status} → ${input.status}` : "notes updated"}`,
      data: { before: { status: lead.status, adminNotes: lead.adminNotes }, after: patch },
      ip: ctx.ip,
      createdAt: ctx.now,
    }),
  ]);
  return { id };
}

export async function newLeadCount(db: Db) {
  const r = await db.select({ n: sql<number>`count(*)` }).from(quoteRequests).where(eq(quoteRequests.status, "NEW")).get();
  return Number(r?.n ?? 0);
}

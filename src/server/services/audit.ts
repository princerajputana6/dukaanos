import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { istDayStartMs, addDays } from "@/lib/dates";
import { auditLogs, users } from "@/server/db/schema";
import type { listAuditSchema } from "@/schemas/admin";
import { requirePermission, type ServiceContext } from "./context";

export async function listAudit(ctx: ServiceContext, input: z.output<typeof listAuditSchema>) {
  requirePermission(ctx, "audit.view");
  const offset = Number(input.cursor ?? 0) || 0;
  const conds: SQL[] = [eq(auditLogs.businessId, ctx.businessId)];
  if (input.entityType) conds.push(eq(auditLogs.entityType, input.entityType));
  if (input.entityId) conds.push(eq(auditLogs.entityId, input.entityId));
  if (input.userId) conds.push(eq(auditLogs.userId, input.userId));
  if (input.source) conds.push(eq(auditLogs.source, input.source));
  if (input.action) conds.push(eq(auditLogs.action, input.action));
  if (input.from) conds.push(gte(auditLogs.createdAt, istDayStartMs(input.from)));
  if (input.to) conds.push(lte(auditLogs.createdAt, istDayStartMs(addDays(input.to, 1)) - 1));
  if (input.q) conds.push(sql`${auditLogs.summary} like ${`%${input.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`} escape '\\'`);
  const rows = await ctx.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      beforeData: auditLogs.beforeData,
      afterData: auditLogs.afterData,
      source: auditLogs.source,
      createdAt: auditLogs.createdAt,
      userId: auditLogs.userId,
      userName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(and(...conds))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(input.limit + 1)
    .offset(offset);
  return { items: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? String(offset + input.limit) : null };
}

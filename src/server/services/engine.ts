/**
 * Transaction engine primitives.
 *
 * D1 has no interactive transactions, so every mutation is:
 *   read → validate → build a list of statements → db.batch() (atomic, all-or-nothing).
 * Race conditions between read and write are closed by DB guards inside the batch
 * (stock trigger, idempotency PK, unique document numbers). See ARCHITECTURE.md §2.
 */
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { newId } from "@/lib/ids";
import { auditLogs, appEvents, counters, idempotencyKeys } from "@/server/db/schema";
import { sha256Hex, stableStringify } from "@/server/lib/crypto";
import { AppError, collectMessages, mapDbError } from "@/server/lib/errors";
import type { ServiceContext } from "./context";

export type Stmt = BatchItem<"sqlite">;

export interface IdempotencyTicket {
  key: string;
  requestHash: string;
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9:_\-.]{8,128}$/;

/**
 * Checks an idempotency key before doing any work.
 *  - unseen key → returns a ticket that `commit` records atomically with the mutation
 *  - seen key + same request → returns the stored response (safe replay)
 *  - seen key + different request → IDEMPOTENCY_KEY_REUSED
 */
export async function checkIdempotency<T>(
  ctx: ServiceContext,
  key: string | undefined | null,
  request: unknown,
): Promise<{ replay: T } | { ticket: IdempotencyTicket | null }> {
  if (!key) return { ticket: null };
  if (!IDEMPOTENCY_KEY_RE.test(key)) throw new AppError("VALIDATION_ERROR", "Invalid idempotency key.");
  const requestHash = await sha256Hex(stableStringify(request));
  const existing = await ctx.db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.businessId, ctx.businessId), eq(idempotencyKeys.key, key)))
    .get();
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError("IDEMPOTENCY_KEY_REUSED", "This request key was already used for a different request.");
    }
    return { replay: JSON.parse(existing.responseJson) as T };
  }
  return { ticket: { key, requestHash } };
}

/** Error thrown when a document-number race is detected; callers re-plan and retry. */
export class NumberConflict extends Error {}

/**
 * Executes `stmts` atomically. When `ticket` is given, the idempotency record (with the
 * response) is written FIRST in the same batch, so a concurrent duplicate aborts entirely.
 */
export async function commit<T>(ctx: ServiceContext, stmts: Stmt[], result: T, ticket?: IdempotencyTicket | null): Promise<T> {
  // Licence / suspension guard: every business write passes through here.
  if (ctx.writable === false) throw new AppError("LICENSE_INACTIVE", ctx.readOnlyReason ?? "This shop is read-only right now.");
  const items: Stmt[] = [];
  if (ticket) {
    items.push(
      ctx.db.insert(idempotencyKeys).values({
        businessId: ctx.businessId,
        key: ticket.key,
        requestHash: ticket.requestHash,
        responseJson: JSON.stringify(result),
        createdAt: ctx.now,
      }),
    );
  }
  items.push(...stmts);
  if (items.length === 0) return result;
  try {
    await ctx.db.batch(items as [Stmt, ...Stmt[]]);
  } catch (err) {
    const msg = collectMessages(err);
    if (/invoice_number|purchase_number/.test(msg)) throw new NumberConflict(msg);
    if (ticket && msg.includes("idempotency_keys")) {
      // Lost a race with an identical request — return what the winner stored.
      const stored = await ctx.db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.businessId, ctx.businessId), eq(idempotencyKeys.key, ticket.key)))
        .get();
      if (stored && stored.requestHash === ticket.requestHash) return JSON.parse(stored.responseJson) as T;
      throw new AppError("IDEMPOTENCY_KEY_REUSED", "This request key was already used for a different request.");
    }
    const mapped = mapDbError(err);
    if (mapped) throw mapped;
    ctx.logger.error("batch commit failed", { error: msg, statements: items.length });
    throw err;
  }
  return result;
}

/** Retries a plan+commit function when a document-number race occurs. */
export async function withNumberRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NumberConflict && i < attempts - 1) continue;
      if (err instanceof NumberConflict) throw new AppError("CONFLICT", "Please try again — another entry was saved at the same time.");
      throw err;
    }
  }
}

/**
 * Reserves the next document number (e.g. INV-0042). The number is read here and the
 * counter bump is part of the caller's batch; the unique index on the document number
 * detects the rare concurrent collision (→ NumberConflict → retry).
 */
export async function reserveNumber(ctx: ServiceContext, name: string, prefix: string): Promise<{ number: string; stmt: Stmt }> {
  const row = await ctx.db
    .select({ value: counters.value })
    .from(counters)
    .where(and(eq(counters.businessId, ctx.businessId), eq(counters.name, name)))
    .get();
  const next = (row?.value ?? 0) + 1;
  const stmt = ctx.db
    .insert(counters)
    .values({ businessId: ctx.businessId, name, value: next })
    .onConflictDoUpdate({ target: [counters.businessId, counters.name], set: { value: sql`max(${counters.value}, excluded.value)` } });
  return { number: `${prefix}-${String(next).padStart(4, "0")}`, stmt };
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

export function auditStmt(ctx: ServiceContext, entry: AuditEntry): Stmt {
  return ctx.db.insert(auditLogs).values({
    id: newId(ctx.now),
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary.slice(0, 500),
    beforeData: entry.before ?? null,
    afterData: entry.after ?? null,
    source: ctx.source,
    requestId: ctx.requestId,
    ip: ctx.ip,
    createdAt: ctx.now,
  });
}

export function eventStmt(ctx: ServiceContext, name: string, props: Record<string, unknown> = {}): Stmt {
  return ctx.db.insert(appEvents).values({
    id: newId(ctx.now),
    businessId: ctx.businessId,
    userId: ctx.userId,
    name,
    props: { ...props, source: ctx.source },
    createdAt: ctx.now,
  });
}

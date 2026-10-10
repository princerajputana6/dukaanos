import type { AuditSource, Permission } from "@/lib/domain";
import type { Db } from "@/server/db/client";
import { forbidden } from "@/server/lib/errors";
import type { Logger } from "@/server/lib/logger";

/**
 * Everything a domain service needs. Built by the API layer from the authenticated
 * session — `businessId` is NEVER taken from client input.
 */
export interface ServiceContext {
  db: Db;
  env: Env;
  businessId: string;
  userId: string;
  userName: string;
  roleKey: string;
  permissions: ReadonlySet<Permission>;
  source: AuditSource;
  requestId: string;
  ip: string | null;
  now: number;
  logger: Logger;
  /** False when the shop/tenant/licence is not in good standing (see ShopAccess). */
  writable?: boolean;
  readOnlyReason?: string | null;
}

export function can(ctx: Pick<ServiceContext, "permissions">, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function requirePermission(ctx: Pick<ServiceContext, "permissions">, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw forbidden();
}

/** Same context, different audit source (e.g. VOICE confirmations). */
export function withSource(ctx: ServiceContext, source: AuditSource): ServiceContext {
  return { ...ctx, source };
}

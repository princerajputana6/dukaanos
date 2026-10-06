import type { Db } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/session";
import type { Logger } from "@/server/lib/logger";
import type { ServiceContext } from "@/server/services/context";

export interface AppVariables {
  requestId: string;
  logger: Logger;
  db: Db;
  now: number;
  ip: string | null;
  session: SessionUser | null;
  /** Present on routes behind `requireBusiness`. */
  ctx: ServiceContext;
}

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}

/**
 * Cloudflare runtime types, exposed globally WITHOUT pulling the full workers
 * runtime lib (which conflicts with the DOM lib used by client components).
 * Drizzle's D1 driver expects `D1Database`/`D1Result` to exist globally.
 */
import type * as CF from "@cloudflare/workers-types";

declare global {
  type D1Database = CF.D1Database;
  type D1Result<T = unknown> = CF.D1Result<T>;
  type D1PreparedStatement = CF.D1PreparedStatement;
  type R2Bucket = CF.R2Bucket;
  type R2ObjectBody = CF.R2ObjectBody;
  type Ai = CF.Ai;
  type RateLimit = CF.RateLimit;
  type ScheduledController = CF.ScheduledController;
  type ExecutionContext = CF.ExecutionContext;
  type SendEmail = CF.SendEmail;

  /** Worker bindings & vars (see wrangler.jsonc). */
  interface Env {
    DB: D1Database;
    FILES?: R2Bucket;
    AI?: Ai;
    AUTH_LIMITER?: RateLimit;
    AI_LIMITER?: RateLimit;
    ENVIRONMENT: "development" | "staging" | "production" | "test";
    APP_URL: string;
    AI_MODEL?: string;
    STT_MODEL?: string;
    FLAG_VOICE_ENABLED?: string;
    FLAG_AI_INSIGHTS_ENABLED?: string;
    FLAG_OFFLINE_ENABLED?: string;
    FLAG_GST_ENABLED?: string;
    FLAG_REPORTS_ENABLED?: string;
    /** Sender address on a domain onboarded to Cloudflare Email Service (password resets). */
    EMAIL_FROM?: string;
    /** Cloudflare Email Service `send_email` binding (optional). */
    EMAIL?: SendEmail;
  }
}

export {};

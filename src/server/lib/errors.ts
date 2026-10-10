/** Typed application errors → standard `{ success: false, error: { code, message } }` envelope. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PRODUCT_NOT_FOUND"
  | "CUSTOMER_NOT_FOUND"
  | "SUPPLIER_NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INSUFFICIENT_STOCK"
  | "CUSTOMER_REQUIRED"
  | "INVALID_AMOUNT"
  | "ALREADY_REVERSED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_DISABLED"
  | "MOBILE_TAKEN"
  | "EMAIL_TAKEN"
  | "INVALID_TOKEN"
  | "CSRF_REJECTED"
  | "RATE_LIMITED"
  | "FEATURE_DISABLED"
  | "LICENSE_INACTIVE"
  | "LIMIT_REACHED"
  | "AI_UNAVAILABLE"
  | "INTERACTION_EXPIRED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_AMOUNT: 400,
  CUSTOMER_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_TOKEN: 400,
  FORBIDDEN: 403,
  ACCOUNT_DISABLED: 403,
  CSRF_REJECTED: 403,
  FEATURE_DISABLED: 403,
  LICENSE_INACTIVE: 403,
  LIMIT_REACHED: 409,
  NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  SUPPLIER_NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  INSUFFICIENT_STOCK: 409,
  ALREADY_REVERSED: 409,
  MOBILE_TAKEN: 409,
  EMAIL_TAKEN: 409,
  INTERACTION_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const forbidden = (msg = "You don't have permission to do this.") => new AppError("FORBIDDEN", msg);

export interface ErrorBody {
  success: false;
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function toErrorBody(err: AppError): ErrorBody {
  return {
    success: false,
    error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
  };
}

/**
 * Maps low-level D1/SQLite failures (trigger RAISE, constraint violations) to AppErrors.
 * Returns null when the error is not recognised.
 */
export function mapDbError(err: unknown): AppError | null {
  const msg = collectMessages(err);
  if (msg.includes("INSUFFICIENT_STOCK")) return new AppError("INSUFFICIENT_STOCK", "Not enough stock for this change.");
  if (msg.includes("reversals.")) return new AppError("ALREADY_REVERSED", "This entry has already been reversed.");
  if (msg.includes("idempotency_keys")) return new AppError("DUPLICATE", "This request was already processed.");
  if (msg.includes("UNIQUE constraint failed")) return new AppError("DUPLICATE", "A record with these details already exists.");
  return null;
}

/** D1 wraps errors ("D1_ERROR: ...", cause chains); gather every message in the chain. */
export function collectMessages(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(" | ");
}

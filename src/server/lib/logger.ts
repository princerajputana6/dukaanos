/**
 * Structured JSON logger. Workers Logs indexes JSON fields, so every line is one object.
 * Sensitive keys are redacted recursively — never log passwords, tokens or secrets.
 */
type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|otp|hash/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  const write = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...base, ...(redact(fields ?? {}) as object) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.message, errorName: err.name, stack: err.stack?.split("\n").slice(0, 6).join("\n") };
  return { error: String(err) };
}

export const logger = createLogger({ service: "dukaanos" });

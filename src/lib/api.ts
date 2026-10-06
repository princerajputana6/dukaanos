/**
 * Browser API client. Every response uses the envelope
 *   { success: true, data } | { success: false, error: { code, message } }
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** True when the request never reached the server (offline / network failure). */
  get isNetwork() {
    return this.code === "NETWORK_ERROR";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? "GET", headers, body, signal: opts.signal, credentials: "same-origin" });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("NETWORK_ERROR", "You seem to be offline. Please check your connection.", 0);
  }

  let json: { success: boolean; data?: T; error?: { code: string; message: string; details?: unknown } } | null = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response (e.g. proxy error)
  }
  if (!res.ok || !json?.success) {
    const e = json?.error;
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.dispatchEvent(new CustomEvent("dukaan:unauthenticated"));
    }
    throw new ApiError(e?.code ?? "HTTP_ERROR", e?.message ?? `Request failed (${res.status})`, res.status, e?.details);
  }
  return json.data as T;
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const apiPost = <T>(path: string, body?: unknown, idempotencyKey?: string) => api<T>(path, { method: "POST", body, idempotencyKey });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

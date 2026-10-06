"use client";
import { useCallback, useRef } from "react";

/**
 * One idempotency key per logical submission: retries of the same form reuse it (so a flaky
 * network can't double-record), and `reset()` issues a fresh key after success.
 */
export function useIdempotencyKey() {
  const ref = useRef<string | null>(null);
  const get = useCallback(() => (ref.current ??= crypto.randomUUID()), []);
  const reset = useCallback(() => {
    ref.current = null;
  }, []);
  return { get, reset };
}

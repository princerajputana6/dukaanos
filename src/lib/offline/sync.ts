/**
 * Sync engine: replays queued actions in order when online.
 *  - network failure → stays PENDING with backoff
 *  - 5xx → retried up to MAX_RETRIES, then FAILED
 *  - 4xx business error (e.g. INSUFFICIENT_STOCK) → FAILED immediately, shown to the user
 */
import { api, ApiError } from "@/lib/api";
import { backoffMs, listActions, MAX_RETRIES, removeAction, updateAction, type QueuedAction } from "./queue";

let running: Promise<SyncResult> | null = null;

export interface SyncResult {
  synced: number;
  failed: number;
  pending: number;
}

export function syncQueue(opts: { force?: boolean } = {}): Promise<SyncResult> {
  running ??= run(opts.force ?? false).finally(() => {
    running = null;
  });
  return running;
}

async function run(force: boolean): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, pending: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    result.pending = (await listActions()).filter((a) => a.status === "PENDING").length;
    return result;
  }
  const now = Date.now();
  for (const action of await listActions()) {
    if (action.status === "SYNCED") {
      await removeAction(action.id);
      continue;
    }
    if (action.status === "FAILED" && !force) {
      result.failed++;
      continue;
    }
    if (!force && action.nextAttemptAt > now) {
      result.pending++;
      continue;
    }
    const outcome = await attempt(action);
    if (outcome === "synced") result.synced++;
    else if (outcome === "failed") result.failed++;
    else {
      result.pending++;
      // Network is down again — stop and keep order.
      break;
    }
  }
  return result;
}

async function attempt(action: QueuedAction): Promise<"synced" | "failed" | "pending"> {
  await updateAction(action.id, { status: "SYNCING" });
  try {
    await api(action.path, { method: "POST", body: action.payload, idempotencyKey: action.idempotencyKey });
    await removeAction(action.id);
    return "synced";
  } catch (err) {
    const retryCount = action.retryCount + 1;
    if (err instanceof ApiError && err.isNetwork) {
      await updateAction(action.id, { status: "PENDING", retryCount, nextAttemptAt: Date.now() + backoffMs(retryCount) });
      return "pending";
    }
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      await updateAction(action.id, { status: "FAILED", retryCount, error: err.message });
      return "failed";
    }
    const exhausted = retryCount >= MAX_RETRIES;
    await updateAction(action.id, {
      status: exhausted ? "FAILED" : "PENDING",
      retryCount,
      nextAttemptAt: Date.now() + backoffMs(retryCount),
      error: err instanceof Error ? err.message : "Sync failed",
    });
    return exhausted ? "failed" : "pending";
  }
}

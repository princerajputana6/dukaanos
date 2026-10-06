/**
 * Offline action queue (IndexedDB). Each action carries an idempotency key, so replaying it
 * after a flaky network can never create a duplicate on the server.
 */
import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";

export type QueueStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED";
export type QueueActionType = "CREATE_SALE" | "CREATE_EXPENSE" | "CUSTOMER_PAYMENT" | "CUSTOMER_CREDIT";

export interface QueuedAction {
  id: string;
  type: QueueActionType;
  /** Human readable, e.g. "Sale · ₹240 · 3 items". */
  label: string;
  path: string;
  payload: unknown;
  idempotencyKey: string;
  createdAt: number;
  status: QueueStatus;
  retryCount: number;
  nextAttemptAt: number;
  error: string | null;
  businessId: string;
}

export const MAX_RETRIES = 5;

let store: UseStore | null = null;
function db(): UseStore {
  store ??= createStore("dukaanos-offline", "actions");
  return store;
}

export async function enqueue(action: Omit<QueuedAction, "status" | "retryCount" | "nextAttemptAt" | "error">): Promise<QueuedAction> {
  const full: QueuedAction = { ...action, status: "PENDING", retryCount: 0, nextAttemptAt: 0, error: null };
  await set(full.id, full, db());
  notify();
  return full;
}

export async function listActions(): Promise<QueuedAction[]> {
  const ids = await keys(db());
  const items = await Promise.all(ids.map((k) => get<QueuedAction>(k, db())));
  return items.filter((a): a is QueuedAction => !!a).sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateAction(id: string, patch: Partial<QueuedAction>): Promise<void> {
  const cur = await get<QueuedAction>(id, db());
  if (!cur) return;
  await set(id, { ...cur, ...patch }, db());
  notify();
}

export async function removeAction(id: string): Promise<void> {
  await del(id, db());
  notify();
}

/** Exponential backoff: 2s, 4s, 8s, 16s, 32s. */
export function backoffMs(retryCount: number): number {
  return Math.min(60_000, 1000 * 2 ** retryCount);
}

const listeners = new Set<() => void>();
export function subscribeQueue(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notify() {
  for (const l of listeners) l();
}

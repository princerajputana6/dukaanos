/**
 * Submits a mutation; if the network is unavailable (and offline mode is on) the action is
 * queued with the SAME idempotency key and reported as queued — never as confirmed.
 */
import { api, ApiError } from "@/lib/api";
import { enqueue, type QueueActionType } from "./queue";

export type SubmitResult<T> = { queued: false; data: T } | { queued: true; queueId: string };

export async function submitOrQueue<T>(opts: {
  type: QueueActionType;
  label: string;
  path: string;
  payload: unknown;
  idempotencyKey: string;
  businessId: string;
  offlineEnabled: boolean;
}): Promise<SubmitResult<T>> {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  if (!offline) {
    try {
      const data = await api<T>(opts.path, { method: "POST", body: opts.payload, idempotencyKey: opts.idempotencyKey });
      return { queued: false, data };
    } catch (err) {
      if (!(err instanceof ApiError && err.isNetwork) || !opts.offlineEnabled) throw err;
    }
  } else if (!opts.offlineEnabled) {
    throw new ApiError("NETWORK_ERROR", "You are offline. Connect to the internet to save this.", 0);
  }
  const queued = await enqueue({
    id: opts.idempotencyKey,
    type: opts.type,
    label: opts.label,
    path: opts.path,
    payload: opts.payload,
    idempotencyKey: opts.idempotencyKey,
    createdAt: Date.now(),
    businessId: opts.businessId,
  });
  return { queued: true, queueId: queued.id };
}

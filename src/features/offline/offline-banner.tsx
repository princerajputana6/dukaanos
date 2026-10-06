"use client";
import { CloudOffIcon, RefreshCwIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useOfflineQueue } from "./use-offline-queue";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/** Honest connectivity status: queued items are "pending", never shown as confirmed. */
export function OfflineBanner() {
  const online = useOnline();
  const { pending, failed, syncing, syncNow } = useOfflineQueue();
  if (online && pending === 0 && failed === 0) return null;
  return (
    <div role="status" className={online ? "bg-info-soft text-info" : "bg-warning-soft text-warning-foreground"}>
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-[13px] font-medium md:px-6">
        {online ? <RefreshCwIcon className={syncing ? "size-4 animate-spin" : "size-4"} /> : <CloudOffIcon className="size-4" />}
        <span className="flex-1">
          {!online
            ? `Offline — changes will sync when you're online.${pending ? ` ${pending} pending.` : ""}`
            : failed
              ? `${failed} offline change${failed > 1 ? "s" : ""} could not sync. Open the queue to review.`
              : `Syncing ${pending} offline change${pending > 1 ? "s" : ""}…`}
        </span>
        {online && (pending > 0 || failed > 0) && (
          <button type="button" className="rounded-lg px-2 py-1 underline underline-offset-2" onClick={() => void syncNow()}>
            {failed ? "Retry" : "Sync now"}
          </button>
        )}
      </div>
    </div>
  );
}

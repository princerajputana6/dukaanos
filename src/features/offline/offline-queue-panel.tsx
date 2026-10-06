"use client";
import { CloudOffIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/dates";
import { removeAction } from "@/lib/offline/queue";
import { useOfflineQueue } from "./use-offline-queue";

/** Actions waiting to sync — clearly marked as NOT yet confirmed by the server. */
export function OfflineQueuePanel() {
  const { actions, syncing, syncNow } = useOfflineQueue();
  if (!actions.length) return null;
  return (
    <section aria-label="Pending offline changes" className="mb-4 rounded-2xl border border-warning/30 bg-warning-soft p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14.5px] font-semibold text-warning-foreground">
          <CloudOffIcon className="size-4" aria-hidden="true" /> {actions.length} change{actions.length > 1 ? "s" : ""} waiting to sync
        </h2>
        <Button size="sm" variant="outline" className="bg-card" onClick={() => void syncNow()} loading={syncing}>
          <RefreshCwIcon /> Sync now
        </Button>
      </div>
      <ul className="space-y-1.5">
        {actions.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-[13.5px]">
            <span className="min-w-0">
              <span className="block truncate font-medium">{a.label}</span>
              <span className="block text-[12px] text-muted-foreground">
                {a.status === "FAILED" ? <span className="text-destructive">Failed: {a.error}</span> : a.status === "SYNCING" ? "Syncing…" : "Pending — not saved yet"} · {formatRelative(a.createdAt)}
              </span>
            </span>
            {a.status === "FAILED" && (
              <Button variant="ghost" size="icon-sm" aria-label="Discard this change" onClick={() => void removeAction(a.id)}>
                <Trash2Icon className="text-muted-foreground" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

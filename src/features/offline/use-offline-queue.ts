"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { listActions, subscribeQueue, type QueuedAction } from "@/lib/offline/queue";
import { syncQueue } from "@/lib/offline/sync";

export function useOfflineQueue() {
  const qc = useQueryClient();
  const [actions, setActions] = useState<QueuedAction[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    listActions()
      .then(setActions)
      .catch(() => setActions([]));
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await syncQueue({ force: true });
      if (r.synced > 0) await qc.invalidateQueries();
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [qc, refresh]);

  useEffect(() => {
    refresh();
    const unsub = subscribeQueue(refresh);
    const onOnline = () => {
      void syncQueue().then((r) => {
        if (r.synced > 0) void qc.invalidateQueries();
      });
    };
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(onOnline, 30_000);
    onOnline();
    return () => {
      unsub();
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [qc, refresh]);

  return {
    actions,
    pending: actions.filter((a) => a.status === "PENDING" || a.status === "SYNCING").length,
    failed: actions.filter((a) => a.status === "FAILED").length,
    syncing,
    syncNow,
  };
}

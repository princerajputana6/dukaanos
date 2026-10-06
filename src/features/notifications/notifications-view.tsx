"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, BellIcon, BookUserIcon, CalendarCheckIcon, CheckCheckIcon, InfoIcon } from "lucide-react";
import Link from "next/link";
import { LoadMore } from "@/components/shared/load-more";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { OfflineQueuePanel } from "@/features/offline/offline-queue-panel";
import { api, apiGet, qs } from "@/lib/api";
import type { NotificationList } from "@/lib/api-types";
import { formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";

const ICON = { LOW_STOCK: AlertTriangleIcon, OUTSTANDING_REMINDER: BookUserIcon, DAILY_SUMMARY: CalendarCheckIcon, SYSTEM: InfoIcon } as const;

export function NotificationsView() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ["notifications", "list"],
    queryFn: ({ pageParam, signal }) => apiGet<NotificationList>(`/notifications${qs({ cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const markAll = async () => {
    await api("/notifications/read-all", { method: "POST" });
    await qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const markRead = (id: string) => {
    void api(`/notifications/${id}/read`, { method: "POST" }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }));
  };
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Notifications"
        actions={
          items.some((n) => !n.readAt) && (
            <Button variant="outline" onClick={markAll}>
              <CheckCheckIcon /> Mark all read
            </Button>
          )
        }
      />
      <OfflineQueuePanel />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={BellIcon} title="You're all caught up." description="Low-stock alerts, udhaar reminders and daily summaries appear here." />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((n) => {
              const Icon = ICON[n.type as keyof typeof ICON] ?? InfoIcon;
              const body = (
                <div className={cn("flex gap-3 px-4 py-3.5", !n.readAt && "bg-primary-soft/40")}>
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", n.type === "LOW_STOCK" ? "bg-warning-soft text-warning-foreground" : "bg-primary-soft text-primary")}>
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[14.5px] font-semibold">
                      {n.title}
                      {!n.readAt && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
                    </p>
                    <p className="text-[13.5px] text-muted-foreground">{n.body}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{formatRelative(n.createdAt)}</p>
                  </div>
                </div>
              );
              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link href={n.link} onClick={() => markRead(n.id)} className="block hover:bg-accent/60">
                      {body}
                    </Link>
                  ) : (
                    <button type="button" className="block w-full text-left" onClick={() => markRead(n.id)}>
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} />
        </>
      )}
    </div>
  );
}

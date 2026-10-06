"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDownIcon, HistoryIcon, LockIcon, SearchIcon } from "lucide-react";
import * as React from "react";
import { LoadMore } from "@/components/shared/load-more";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { useCan } from "@/features/session/session-context";
import { useDebounced } from "@/hooks/use-debounced";
import { apiGet, qs } from "@/lib/api";
import type { AuditItem, AuditList } from "@/lib/api-types";
import { formatDateTime } from "@/lib/dates";
import { AUDIT_SOURCES } from "@/lib/domain";
import { initials } from "@/lib/text";
import { cn } from "@/lib/utils";

const ENTITY_TYPES = ["sale", "purchase", "product", "customer", "supplier", "expense", "member", "business", "business_settings", "gst_settings", "role"];
const SOURCE_VARIANT = { WEB: "neutral", VOICE: "info", IMPORT: "warning", SYSTEM: "outline" } as const;

export function AuditView() {
  const can = useCan();
  const url = useUrlState();
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q, 300);
  const source = url.get("source") ?? "";
  const entityType = url.get("entity") ?? "";
  const list = useInfiniteQuery({
    queryKey: ["audit", source, entityType, dq],
    queryFn: ({ pageParam, signal }) => apiGet<AuditList>(`/audit${qs({ source: source || undefined, entityType: entityType || undefined, q: dq || undefined, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: can("audit.view"),
  });
  if (!can("audit.view")) return <EmptyState icon={LockIcon} title="Only the owner can see the audit log." />;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Audit log" description="Every important change: who, what, when and from where." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-10" placeholder="Search changes" aria-label="Search audit log" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:w-80">
          <NativeSelect aria-label="Source" value={source} onChange={(e) => url.set({ source: e.target.value || null })}>
            <option value="">All sources</option>
            {AUDIT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Type" value={entityType} onChange={(e) => url.set({ entity: e.target.value || null })}>
            <option value="">All types</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No matching changes." />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((a) => (
              <AuditRow key={a.id} a={a} />
            ))}
          </ul>
          <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </>
      )}
    </div>
  );
}

function AuditRow({ a }: { a: AuditItem }) {
  const [open, setOpen] = React.useState(false);
  const hasData = a.beforeData != null || a.afterData != null;
  return (
    <li>
      <button type="button" className="flex w-full gap-3 px-4 py-3 text-left hover:bg-accent/50" aria-expanded={open} onClick={() => hasData && setOpen((o) => !o)}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-bold">{initials(a.userName ?? "System")}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <strong>{a.userName ?? "System"}</strong>
            <Badge variant={SOURCE_VARIANT[a.source as keyof typeof SOURCE_VARIANT] ?? "neutral"}>{a.source}</Badge>
            <span className="text-muted-foreground">{a.action.replace(/_/g, " ").toLowerCase()}</span>
          </span>
          <span className="mt-0.5 block text-[14px]">{a.summary}</span>
          <span className="text-[12px] text-muted-foreground">{formatDateTime(a.createdAt)}</span>
        </span>
        {hasData && <ChevronDownIcon className={cn("mt-2 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />}
      </button>
      {open && (
        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          {a.beforeData != null && <DataBlock title="Before" data={a.beforeData} />}
          {a.afterData != null && <DataBlock title="After" data={a.afterData} />}
        </div>
      )}
    </li>
  );
}

function DataBlock({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <p className="mb-1 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <pre className="max-h-60 overflow-auto text-[12px] leading-relaxed whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

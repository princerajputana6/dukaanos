"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { InboxIcon, MailIcon, MessageCircleIcon, PhoneIcon, SearchIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Field } from "@/components/shared/field";
import { LoadMore } from "@/components/shared/load-more";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { useDebounced } from "@/hooks/use-debounced";
import { api, apiGet, errorMessage, qs } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { BUSINESS_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { LEAD_STATUSES, type LeadStatus } from "@/schemas/marketing";

interface Lead {
  id: string;
  name: string;
  businessName: string;
  mobile: string;
  email: string | null;
  city: string | null;
  businessType: string | null;
  outlets: string | null;
  message: string | null;
  status: LeadStatus;
  adminNotes: string | null;
  source: string | null;
  createdAt: number;
  updatedAt: number;
}
interface LeadList {
  items: Lead[];
  nextCursor: string | null;
  counts: Partial<Record<LeadStatus, number>>;
}

const STATUS_META: Record<LeadStatus, { label: string; variant: "info" | "warning" | "success" | "neutral" }> = {
  NEW: { label: "New", variant: "info" },
  CONTACTED: { label: "Contacted", variant: "warning" },
  CONVERTED: { label: "Converted", variant: "success" },
  CLOSED: { label: "Closed", variant: "neutral" },
};
const typeLabel = (t: string | null) => BUSINESS_TYPES.find((b) => b.value === t)?.label ?? null;

/** Quote requests from the public website. */
export function LeadsView() {
  const url = useUrlState();
  const status = url.get("status") ?? "";
  const [q, setQ] = React.useState(url.get("q") ?? "");
  const dq = useDebounced(q, 250);
  const [open, setOpen] = React.useState<Lead | null>(null);
  const list = useInfiniteQuery({
    queryKey: ["admin", "leads", status, dq],
    queryFn: ({ pageParam, signal }) => apiGet<LeadList>(`/admin/leads${qs({ status: status || undefined, q: dq || undefined, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = list.data?.pages[0]?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <div>
      <PageHeader title="Leads" description="Quote requests from the Suvakta website. Call new leads within a day." />
      <div className="relative mb-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="pl-10" placeholder="Search name, shop, mobile or city" aria-label="Search leads" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0" role="group" aria-label="Lead status">
        {[{ id: "", label: `All · ${total}` }, ...LEAD_STATUSES.map((s) => ({ id: s, label: `${STATUS_META[s].label} · ${counts[s] ?? 0}` }))].map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={status === f.id}
            onClick={() => url.set({ status: f.id || null })}
            className={cn("h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium", status === f.id ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent")}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={InboxIcon} title="No leads yet." description="Requests from the website's “Request a quote” form appear here." />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setOpen(l)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-accent/50">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-semibold">
                      {l.businessName}
                      <Badge variant={STATUS_META[l.status].variant}>{STATUS_META[l.status].label}</Badge>
                    </span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {l.name} · +91 {l.mobile}
                      {l.city ? ` · ${l.city}` : ""}
                      {typeLabel(l.businessType) ? ` · ${typeLabel(l.businessType)}` : ""}
                      {l.outlets ? ` · ${l.outlets} outlet${l.outlets === "1" ? "" : "s"}` : ""}
                    </span>
                  </span>
                  <span className="text-[12px] text-muted-foreground">{formatRelative(l.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </>
      )}
      <LeadDetail key={open?.id ?? "none"} lead={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function LeadDetail({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const qc = useQueryClient();
  // Remounted per lead (keyed by id), so the form starts from that lead's values.
  const [status, setStatus] = React.useState<LeadStatus>(lead?.status ?? "NEW");
  const [notes, setNotes] = React.useState(lead?.adminNotes ?? "");
  const [busy, setBusy] = React.useState(false);
  const wa = lead ? `https://wa.me/91${lead.mobile}?text=${encodeURIComponent(`Namaste ${lead.name}, this is the Suvakta team about your request for ${lead.businessName}.`)}` : "#";
  return (
    <ResponsiveModal open={!!lead} onOpenChange={(o) => !o && onClose()} title={lead?.businessName ?? ""} description={lead ? `Requested ${formatDateTime(lead.createdAt)}` : undefined}>
      {lead && (
        <div className="space-y-4 pb-2">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
            <dt className="text-muted-foreground">Contact</dt>
            <dd className="font-medium">{lead.name}</dd>
            <dt className="text-muted-foreground">Mobile</dt>
            <dd>+91 {lead.mobile}</dd>
            {lead.email && (
              <>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{lead.email}</dd>
              </>
            )}
            <dt className="text-muted-foreground">City</dt>
            <dd>{lead.city ?? "—"}</dd>
            <dt className="text-muted-foreground">Business</dt>
            <dd>{typeLabel(lead.businessType) ?? "—"}</dd>
            <dt className="text-muted-foreground">Outlets</dt>
            <dd>{lead.outlets ?? "—"}</dd>
          </dl>
          {lead.message && <p className="rounded-xl bg-muted px-3 py-2.5 text-[13.5px] whitespace-pre-line">{lead.message}</p>}
          <div className="grid grid-cols-3 gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`tel:+91${lead.mobile}`}>
                <PhoneIcon /> Call
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={wa} target="_blank" rel="noreferrer">
                <MessageCircleIcon /> WhatsApp
              </a>
            </Button>
            <Button asChild variant="outline" size="sm" disabled={!lead.email}>
              <a href={lead.email ? `mailto:${lead.email}` : undefined} aria-disabled={!lead.email}>
                <MailIcon /> Email
              </a>
            </Button>
          </div>
          <Field id="lead-status" label="Status">
            <NativeSelect id="lead-status" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="lead-notes" label="Internal notes" optional>
            <Textarea id="lead-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Called on Monday, wants a demo for 2 shops…" />
          </Field>
          <Button
            className="w-full"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/admin/leads/${lead.id}`, { method: "PATCH", body: { status, adminNotes: notes } });
                toast.success("Lead updated");
                await qc.invalidateQueries({ queryKey: ["admin"] });
                onClose();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      )}
    </ResponsiveModal>
  );
}

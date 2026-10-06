"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BookUserIcon, DownloadIcon, HandCoinsIcon, MessageCircleIcon, PencilIcon, PhoneIcon, PlusIcon, ReceiptIcon, ScaleIcon, SearchIcon, TruckIcon, UserPlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { LoadMore } from "@/components/shared/load-more";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCan, useSession } from "@/features/session/session-context";
import { useDebounced } from "@/hooks/use-debounced";
import { apiGet, qs } from "@/lib/api";
import type { CustomerDetail, CustomerList, SupplierDetail, SupplierList } from "@/lib/api-types";
import { formatRelative } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { initials } from "@/lib/text";
import { cn } from "@/lib/utils";
import { LedgerList, MoneyEntrySheet, PartyFormSheet, type MoneyEntryKind, type PartyKind } from "./party-components";

interface PartyRow {
  id: string;
  name: string;
  phone: string | null;
  balancePaise: number;
  lastTxnAt: number | null;
}

const cfg = {
  customer: { path: "/customers", key: "customers", title: "Khata", noun: "customer", icon: BookUserIcon, balanceLabel: "Outstanding", empty: "No customers yet." },
  supplier: { path: "/suppliers", key: "suppliers", title: "Suppliers", noun: "supplier", icon: TruckIcon, balanceLabel: "You owe", empty: "No suppliers yet." },
} as const;

export function PartyListView({ kind }: { kind: PartyKind }) {
  const c = cfg[kind];
  const url = useUrlState();
  const can = useCan();
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q, 250);
  const filter = url.get("filter") ?? "all";
  const [adding, setAdding] = React.useState(url.get("new") !== null);
  const list = useInfiniteQuery({
    queryKey: [c.key, "list", filter, dq],
    queryFn: ({ pageParam, signal }) =>
      apiGet<CustomerList | SupplierList>(`${c.path}${qs({ q: dq || undefined, filter, sort: filter === "outstanding" ? "balance" : "recent", cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items: PartyRow[] = list.data?.pages.flatMap((p) => p.items as PartyRow[]) ?? [];
  const totals = list.data?.pages[0]?.totals as { outstandingPaise: number; withOutstanding?: number } | undefined;
  const canCreate = can(kind === "customer" ? "customer.create" : "supplier.create");

  return (
    <div>
      <PageHeader
        title={c.title}
        description={kind === "customer" ? "Customers, udhaar and payments." : "Suppliers, purchases and what you owe."}
        actions={
          <>
            {can("reports.view") && (
              <Button variant="outline" asChild>
                <a href={`/api${c.path}/export`} download>
                  <DownloadIcon /> <span className="hidden sm:inline">Export</span>
                </a>
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => setAdding(true)}>
                <UserPlusIcon /> Add {c.noun}
              </Button>
            )}
          </>
        }
      />
      {totals && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border bg-card p-4 shadow-soft">
          <div>
            <p className="text-[12.5px] font-medium text-muted-foreground">{kind === "customer" ? "Total udhaar to collect" : "Total payable to suppliers"}</p>
            <Money paise={totals.outstandingPaise} className="text-2xl font-semibold" />
          </div>
          {totals.withOutstanding !== undefined && <p className="text-right text-[13px] text-muted-foreground">{totals.withOutstanding} customers</p>}
        </div>
      )}
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-10" placeholder={`Search ${c.noun}s by name or phone`} aria-label={`Search ${c.noun}s`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex rounded-xl border bg-card p-1" role="group" aria-label="Filter">
          {(["all", "outstanding"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => url.set({ filter: f === "all" ? null : f })}
              className={cn("h-9 rounded-lg px-3 text-[13px] font-semibold", filter === f ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground")}
            >
              {f === "all" ? "All" : kind === "customer" ? "Baki" : "Due"}
            </button>
          ))}
        </div>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={c.icon}
          title={dq || filter !== "all" ? `No ${c.noun}s match.` : c.empty}
          description={kind === "customer" && !dq ? "Add customers to track udhaar. Or say: “Naya customer Ramesh”." : undefined}
          action={canCreate && !dq ? <Button onClick={() => setAdding(true)}><PlusIcon /> Add {c.noun === "customer" ? "Customer" : "Supplier"}</Button> : undefined}
        />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((p) => (
              <li key={p.id}>
                <Link href={`${c.path}/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/60">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[13px] font-bold text-primary">{initials(p.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      {p.phone ? `+91 ${p.phone}` : "No phone"}
                      {p.lastTxnAt ? ` · ${formatRelative(p.lastTxnAt)}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <Money paise={p.balancePaise} className={cn("block text-[15px] font-semibold", p.balancePaise > 0 ? "text-warning-foreground" : p.balancePaise < 0 ? "text-success" : "text-muted-foreground")} />
                    <span className="text-[11.5px] text-muted-foreground">{p.balancePaise > 0 ? c.balanceLabel : p.balancePaise < 0 ? "Advance" : "Settled"}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </>
      )}
      <PartyFormSheet
        kind={kind}
        open={adding}
        onOpenChange={(o) => (setAdding(o), !o && url.get("new") !== null && url.set({ new: null }))}
        initialName={url.get("new") && url.get("new") !== "1" ? (url.get("new") ?? undefined) : undefined}
        onSaved={(id) => router.push(`${c.path}/${id}`)}
      />
    </div>
  );
}

export function PartyDetailView({ kind, id }: { kind: PartyKind; id: string }) {
  const c = cfg[kind];
  const me = useSession();
  const can = useCan();
  const [entry, setEntry] = React.useState<MoneyEntryKind | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [cursor, setCursor] = React.useState<string | undefined>();
  const q = useQuery({
    queryKey: [c.key, "detail", id, cursor],
    queryFn: ({ signal }) => apiGet<CustomerDetail | SupplierDetail>(`${c.path}/${id}${qs({ cursor })}`, signal),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ListSkeleton rows={5} />;
  const party = "customer" in q.data ? q.data.customer : q.data.supplier;
  const ledgerPerm = can(kind === "customer" ? "customer.ledger" : "supplier.ledger");
  const bal = party.balancePaise;
  const reminder =
    kind === "customer" && party.phone && bal > 0
      ? `https://wa.me/91${party.phone}?text=${encodeURIComponent(`Namaste ${party.name} ji, ${me.business.name} mein aapka ${formatMoney(bal, { compact: true })} baki hai. Kripya jaldi jama karein. Dhanyavaad!`)}`
      : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: c.path, label: c.title }}
        title={party.name}
        description={[party.phone ? `+91 ${party.phone}` : null, "company" in party ? party.company : null, "gstin" in party ? party.gstin : null].filter(Boolean).join(" · ") || undefined}
        actions={
          can(kind === "customer" ? "customer.create" : "supplier.create") && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </Button>
          )
        }
      />
      <section className={cn("mb-4 rounded-3xl p-5 shadow-soft", bal > 0 ? "bg-warning-soft" : bal < 0 ? "bg-success-soft" : "border bg-card")}>
        <p className="text-[13px] font-medium text-muted-foreground">{bal > 0 ? c.balanceLabel : bal < 0 ? "Advance" : "All settled"}</p>
        <Money paise={Math.abs(bal)} className="text-[32px] leading-tight font-bold" />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {ledgerPerm && (
            <Button onClick={() => setEntry("payment")}>
              <HandCoinsIcon /> {kind === "customer" ? "Payment received" : "Pay supplier"}
            </Button>
          )}
          {ledgerPerm && kind === "customer" && (
            <Button variant="outline" className="bg-card" onClick={() => setEntry("credit")}>
              <ReceiptIcon /> Add udhaar
            </Button>
          )}
          {ledgerPerm && (
            <Button variant="outline" className="bg-card" onClick={() => setEntry("adjust")}>
              <ScaleIcon /> Adjust
            </Button>
          )}
          {party.phone && (
            <Button variant="outline" className="bg-card" asChild>
              <a href={`tel:+91${party.phone}`}>
                <PhoneIcon /> Call
              </a>
            </Button>
          )}
          {reminder && (
            <Button variant="outline" className="bg-card" asChild>
              <a href={reminder} target="_blank" rel="noopener noreferrer">
                <MessageCircleIcon /> Remind on WhatsApp
              </a>
            </Button>
          )}
        </div>
      </section>
      <div className="mb-4 grid grid-cols-2 gap-3">
        {"orders" in q.data.stats ? (
          <>
            <Stat label="Bills" value={q.data.stats.orders} />
            <Stat label="Total purchases" value={<Money paise={q.data.stats.totalPurchasesPaise} compact />} />
          </>
        ) : (
          <>
            <Stat label="Purchases" value={q.data.stats.purchases} />
            <Stat label="Total bought" value={<Money paise={q.data.stats.totalPurchasesPaise} compact />} />
          </>
        )}
      </div>
      {"productsSupplied" in q.data && q.data.productsSupplied.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Products supplied</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {q.data.productsSupplied.map((p) => (
              <Link key={p.id} href={`/inventory/${p.id}`} className="rounded-full border px-3 py-1 text-[13px] hover:bg-accent">
                {p.name}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{kind === "customer" ? "Khata" : "Account"}</CardTitle>
        </CardHeader>
        <CardContent>
          <LedgerList kind={kind} partyId={id} entries={q.data.ledger} canReverse={ledgerPerm && can("sales.delete")} />
          <div className="flex justify-center gap-2 pt-2">
            {cursor && (
              <Button variant="ghost" size="sm" onClick={() => setCursor(undefined)}>
                Latest
              </Button>
            )}
            {q.data.nextCursor && (
              <Button variant="outline" size="sm" onClick={() => setCursor(q.data.nextCursor ?? undefined)}>
                Older entries
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {entry && <MoneyEntrySheet kind={kind} entry={entry} party={{ id, name: party.name, balancePaise: bal }} open={!!entry} onOpenChange={(o) => !o && setEntry(null)} />}
      <PartyFormSheet kind={kind} open={editing} onOpenChange={setEditing} existing={{ ...party, id }} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-3.5">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

"use client";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { BookUserIcon, MicIcon, PackageIcon, PlusIcon, ReceiptIcon, SearchIcon, ShoppingBagIcon, TruckIcon, WalletIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCan } from "@/features/session/session-context";
import { useVoiceStore } from "@/features/voice/voice-store";
import { useDebounced } from "@/hooks/use-debounced";
import { apiGet, qs } from "@/lib/api";
import type { SearchResults } from "@/lib/api-types";
import { formatMoney } from "@/lib/money";
import { formatQty } from "@/lib/qty";

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const can = useCan();
  const openVoice = useVoiceStore((s) => s.openSheet);
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q.trim(), 200);
  const { data, isFetching } = useQuery({
    queryKey: ["search", dq],
    queryFn: ({ signal }) => apiGet<SearchResults>(`/search${qs({ q: dq })}`, signal),
    enabled: open && dq.length >= 1,
    staleTime: 10_000,
  });

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };

  const actions = [
    { label: "New sale", href: "/sales/new", icon: ReceiptIcon, show: can("sales.create") },
    { label: "New purchase", href: "/purchases/new", icon: ShoppingBagIcon, show: can("purchase.create") },
    { label: "Add product", href: "/products/new", icon: PackageIcon, show: can("inventory.create") },
    { label: "Add customer", href: "/customers?new=1", icon: BookUserIcon, show: can("customer.create") },
    { label: "Add expense", href: "/expenses?new=1", icon: WalletIcon, show: can("expense.create") },
  ].filter((a) => a.show);

  const empty = dq && data && !data.products.length && !data.customers.length && !data.suppliers.length && !data.sales.length;

  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), o || setQ(""))}>
      <DialogContent hideClose className="top-4 max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:top-[12vh]">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search products, customers, suppliers and bills</DialogDescription>
        <Command shouldFilter={false} label="Global search" className="flex max-h-[70dvh] flex-col">
          <div className="flex items-center gap-2 border-b px-4">
            <SearchIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <Command.Input
              value={q}
              onValueChange={setQ}
              autoFocus
              placeholder="Search coke, कोक, Ramesh, INV-0012…"
              className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground"
            />
            {isFetching && <span className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden="true" />}
          </div>
          <Command.List className="overflow-y-auto p-2">
            {empty && <Command.Empty className="py-10 text-center text-sm text-muted-foreground">No results for “{dq}”.</Command.Empty>}
            {!dq && (
              <Command.Group heading="Quick actions" className={groupCls}>
                <Item onSelect={() => (onOpenChange(false), openVoice({ listen: true }))} icon={MicIcon} label="Talk to Suvakta" />
                {actions.map((a) => (
                  <Item key={a.href} onSelect={() => go(a.href)} icon={a.icon ?? PlusIcon} label={a.label} />
                ))}
              </Command.Group>
            )}
            {!!data?.products.length && (
              <Command.Group heading="Products" className={groupCls}>
                {data.products.map((p) => (
                  <Item
                    key={p.id}
                    onSelect={() => go(`/inventory/${p.id}`)}
                    icon={PackageIcon}
                    label={p.name}
                    meta={`${formatMoney(p.sellingPricePaise, { compact: true })}${p.trackStock ? ` · ${formatQty(Math.max(0, p.stockMilli))} ${p.unit}` : ""}`}
                  />
                ))}
              </Command.Group>
            )}
            {!!data?.customers.length && (
              <Command.Group heading="Customers" className={groupCls}>
                {data.customers.map((c) => (
                  <Item key={c.id} onSelect={() => go(`/customers/${c.id}`)} icon={BookUserIcon} label={c.name} meta={c.balancePaise > 0 ? `Baki ${formatMoney(c.balancePaise, { compact: true })}` : (c.phone ?? undefined)} />
                ))}
              </Command.Group>
            )}
            {!!data?.suppliers.length && (
              <Command.Group heading="Suppliers" className={groupCls}>
                {data.suppliers.map((s) => (
                  <Item key={s.id} onSelect={() => go(`/suppliers/${s.id}`)} icon={TruckIcon} label={s.name} meta={s.company ?? undefined} />
                ))}
              </Command.Group>
            )}
            {!!data?.sales.length && (
              <Command.Group heading="Bills" className={groupCls}>
                {data.sales.map((s) => (
                  <Item key={s.id} onSelect={() => go(`/sales/${s.id}`)} icon={ReceiptIcon} label={s.invoiceNumber} meta={`${formatMoney(s.totalPaise, { compact: true })}${s.status === "REVERSED" ? " · reversed" : ""}`} />
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

const groupCls = "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase";

function Item({ onSelect, icon: Icon, label, meta }: { onSelect: () => void; icon: React.ComponentType<{ className?: string }>; label: string; meta?: string }) {
  return (
    <Command.Item onSelect={onSelect} value={`${label}-${meta ?? ""}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2.5 text-[14.5px] data-[selected=true]:bg-accent">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate font-medium">{label}</span>
      {meta && <span className="shrink-0 text-[12.5px] text-muted-foreground">{meta}</span>}
    </Command.Item>
  );
}

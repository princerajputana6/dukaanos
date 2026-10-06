"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, PlusIcon, SearchIcon, UserPlusIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { useDebounced } from "@/hooks/use-debounced";
import { api, apiGet, errorMessage, qs } from "@/lib/api";
import type { CustomerList, ProductList, ProductListItem, SupplierList } from "@/lib/api-types";
import { normalizeText, phoneticKey, tokenize } from "@/lib/text";
import { cn } from "@/lib/utils";

/** All active products, cached for instant client-side search (works offline once loaded). */
export function useProductCatalog() {
  return useQuery({
    queryKey: ["products", "catalog"],
    queryFn: ({ signal }) => apiGet<ProductList>("/products?limit=200&sort=name", signal),
    staleTime: 60_000,
  });
}

/** Client-side match mirroring the server's normalised + phonetic search. */
export function matchProducts(items: ProductListItem[], q: string): ProductListItem[] {
  const query = q.trim();
  if (!query) return items;
  const exact = items.filter((p) => p.barcode === query || p.sku === query);
  if (exact.length) return exact;
  const tokens = tokenize(query);
  return items.filter((p) => {
    const hay = normalizeText(`${p.name} ${p.brand ?? ""} ${p.categoryName ?? ""}`);
    const hayPh = hay
      .split(" ")
      .map((w) => (/^\d/.test(w) ? w : phoneticKey(w)))
      .join(" ");
    return tokens.every((t) => hay.includes(t) || (!/^\d/.test(t) && phoneticKey(t).length >= 2 && hayPh.includes(phoneticKey(t))));
  });
}

type Party = { id: string; name: string; phone?: string | null; balancePaise: number };

/** Customer / supplier chooser with inline "add new". */
export function PartyPicker({
  kind,
  open,
  onOpenChange,
  onSelect,
  selectedId,
}: {
  kind: "customer" | "supplier";
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSelect: (p: Party | null) => void;
  selectedId?: string | null;
}) {
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const dq = useDebounced(q, 200);
  const path = kind === "customer" ? "/customers" : "/suppliers";
  const list = useQuery({
    queryKey: [kind === "customer" ? "customers" : "suppliers", "picker", dq],
    queryFn: ({ signal }) => apiGet<CustomerList | SupplierList>(`${path}${qs({ q: dq || undefined, limit: 30, sort: "recent" })}`, signal),
    enabled: open,
  });
  const create = useMutation({
    mutationFn: () => api<{ id: string; name: string }>(path, { method: "POST", body: { name: name.trim(), phone: phone.trim() || null }, idempotencyKey: crypto.randomUUID() }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: [kind === "customer" ? "customers" : "suppliers"] });
      toast.success(`${r.name} added`);
      onSelect({ id: r.id, name: r.name, phone: phone || null, balancePaise: 0 });
      reset();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = () => {
    setAdding(false);
    setName("");
    setPhone("");
    setQ("");
    onOpenChange(false);
  };
  const label = kind === "customer" ? "customer" : "supplier";
  return (
    <ResponsiveModal open={open} onOpenChange={(o) => (o ? onOpenChange(o) : reset())} title={adding ? `New ${label}` : `Choose ${label}`}>
      {adding ? (
        <form
          className="space-y-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input autoFocus placeholder="Name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="tel" inputMode="numeric" placeholder="Mobile (optional)" aria-label="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Back
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              Add {label}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus className="pl-10" placeholder={`Search ${label}s`} aria-label={`Search ${label}s`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button variant="soft" onClick={() => (setAdding(true), setName(q))}>
            <UserPlusIcon /> Add new {label}
            {q ? ` “${q}”` : ""}
          </Button>
          <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-xl border">
            {selectedId && (
              <li>
                <button type="button" className="w-full px-3.5 py-3 text-left text-[14px] text-muted-foreground hover:bg-accent" onClick={() => (onSelect(null), reset())}>
                  No {label} (walk-in)
                </button>
              </li>
            )}
            {list.isLoading && <li className="px-3.5 py-3 text-sm text-muted-foreground">Loading…</li>}
            {list.data?.items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => (onSelect({ id: p.id, name: p.name, phone: p.phone, balancePaise: p.balancePaise }), reset())}
                  className={cn("flex min-h-12 w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-accent", p.id === selectedId && "bg-primary-soft")}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                    {p.phone && <span className="block text-[12.5px] text-muted-foreground">+91 {p.phone}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    {p.balancePaise !== 0 && <Money paise={p.balancePaise} compact className={cn("text-[13px] font-semibold", p.balancePaise > 0 ? "text-warning-foreground" : "text-success")} />}
                    {p.id === selectedId && <CheckIcon className="size-4 text-primary" />}
                  </span>
                </button>
              </li>
            ))}
            {list.data && list.data.items.length === 0 && (
              <li className="px-3.5 py-6 text-center text-sm text-muted-foreground">
                No {label}s found.{" "}
                <button type="button" className="font-semibold text-primary" onClick={() => (setAdding(true), setName(q))}>
                  <PlusIcon className="inline size-3.5" /> Add
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </ResponsiveModal>
  );
}

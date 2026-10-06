"use client";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Qty } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Segmented } from "@/components/ui/segmented";
import { matchProducts, useProductCatalog } from "@/features/shared/pickers";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { api, errorMessage } from "@/lib/api";
import type { AdjustmentType } from "@/lib/domain";
import { formatQty, toMilli } from "@/lib/qty";

type Mode = "add" | "remove" | "count";
interface Target {
  id: string;
  name: string;
  unit: string;
  currentStockMilli: number;
}

/** Records a stock change with a reason. Never edits stock silently. */
export function AdjustStockSheet({ open, onOpenChange, product }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Target | null }) {
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const catalog = useProductCatalog();
  const [picked, setPicked] = React.useState<Target | null>(null);
  const [q, setQ] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("add");
  const [reasonType, setReasonType] = React.useState<AdjustmentType>("ADJUSTMENT");
  const [qty, setQty] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const target = product ?? picked;

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setPicked(null);
      setQ("");
      setQty("");
      setReason("");
      setMode("add");
      setReasonType("ADJUSTMENT");
    }
  };

  const milli = toMilli(qty || "0") ?? 0;
  const after = !target ? 0 : mode === "count" ? milli : mode === "add" ? target.currentStockMilli + milli : target.currentStockMilli - milli;

  const save = async () => {
    if (!target) return;
    if (mode !== "count" && milli <= 0) return toast.error("Enter a quantity.");
    if (after < 0) return toast.error(`Only ${formatQty(target.currentStockMilli)} ${target.unit} in stock.`);
    setSaving(true);
    try {
      await api("/inventory/adjust", {
        method: "POST",
        idempotencyKey: idem.get(),
        body: {
          productId: target.id,
          // add: Correction | Return · remove: Correction | Damage · count: Correction
          type: mode === "count" ? "ADJUSTMENT" : reasonType,
          mode: mode === "count" ? "set" : "delta",
          direction: mode === "remove" ? "decrease" : "increase",
          quantityMilli: milli,
          reason: reason.trim() || null,
        },
      });
      idem.reset();
      toast.success(`${target.name}: stock now ${formatQty(after)} ${target.unit}`);
      await qc.invalidateQueries();
      close(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={close} title="Adjust stock" description={target ? `${target.name} · now ${formatQty(target.currentStockMilli)} ${target.unit}` : "Choose a product"}>
      {!target ? (
        <div className="space-y-3 pb-2">
          <Input autoFocus placeholder="Search product" aria-label="Search product" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-xl border">
            {matchProducts((catalog.data?.items ?? []).filter((p) => p.trackStock), q)
              .slice(0, 40)
              .map((p) => (
                <li key={p.id}>
                  <button type="button" className="flex min-h-12 w-full items-center justify-between px-3.5 py-2 text-left hover:bg-accent" onClick={() => setPicked(p)}>
                    <span className="text-[14.5px] font-medium">{p.name}</span>
                    <Qty milli={p.currentStockMilli} unit={p.unit} className="text-[13px]" />
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          <Segmented<Mode>
            label="Change type"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setReasonType("ADJUSTMENT");
            }}
            options={[
              { value: "add", label: "Add" },
              { value: "remove", label: "Remove" },
              { value: "count", label: "Set count" },
            ]}
          />
          {mode !== "count" && (
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Segmented<AdjustmentType>
                label="Reason"
                value={reasonType}
                onChange={setReasonType}
                options={
                  mode === "add"
                    ? [
                        { value: "ADJUSTMENT", label: "Correction" },
                        { value: "RETURN", label: "Customer return" },
                      ]
                    : [
                        { value: "ADJUSTMENT", label: "Correction" },
                        { value: "DAMAGE", label: "Damaged / expired" },
                      ]
                }
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="adj-qty">{mode === "count" ? `Counted quantity (${target.unit})` : `Quantity (${target.unit})`}</Label>
            <Input id="adj-qty" autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-note">Note</Label>
            <Input id="adj-note" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 2 bottles broken in delivery" />
          </div>
          <p className="rounded-xl bg-muted px-3.5 py-2.5 text-[14px]">
            Stock: <Qty milli={target.currentStockMilli} /> → <strong className={after < 0 ? "text-destructive" : ""}><Qty milli={after} unit={target.unit} /></strong>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => (product ? close(false) : setPicked(null))}>
              {product ? "Cancel" : "Back"}
            </Button>
            <Button onClick={save} loading={saving} disabled={after < 0 || (mode !== "count" && milli <= 0)}>
              Save change
            </Button>
          </div>
        </div>
      )}
    </ResponsiveModal>
  );
}

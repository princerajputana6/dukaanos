"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MicIcon, PrinterIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money, Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, ListSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCan, useSession } from "@/features/session/session-context";
import { api, apiGet, errorMessage } from "@/lib/api";
import type { SaleDetail } from "@/lib/api-types";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/domain";
import { formatGstRate } from "@/lib/pricing";

export function SaleDetailView({ id }: { id: string }) {
  const me = useSession();
  const can = useCan();
  const qc = useQueryClient();
  const [undo, setUndo] = React.useState(false);
  const q = useQuery({ queryKey: ["sales", "detail", id], queryFn: ({ signal }) => apiGet<SaleDetail>(`/sales/${id}`, signal) });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ListSkeleton rows={4} />;
  const { sale, items, customer, payments, createdByName, reversedByName } = q.data;
  const reversed = sale.status === "REVERSED";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        back={{ href: "/sales", label: "Sales" }}
        title={
          <span className="flex items-center gap-2">
            {sale.invoiceNumber}
            {reversed && <Badge variant="danger">Reversed</Badge>}
            {sale.source === "VOICE" && (
              <Badge variant="info">
                <MicIcon /> Voice
              </Badge>
            )}
          </span>
        }
        description={`${formatDate(sale.txnDate)} · ${formatDateTime(sale.createdAt)}${createdByName ? ` · by ${createdByName}` : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon /> Print
            </Button>
            {can("sales.delete") && !reversed && (
              <Button variant="outline" className="text-destructive" onClick={() => setUndo(true)}>
                <Undo2Icon /> Undo sale
              </Button>
            )}
          </>
        }
      />

      {reversed && (
        <p role="status" className="mb-4 rounded-xl bg-destructive-soft px-4 py-3 text-[13.5px] text-destructive">
          Reversed {sale.reversedAt ? formatDateTime(sale.reversedAt) : ""}
          {reversedByName ? ` by ${reversedByName}` : ""}
          {sale.reversalReason ? ` — “${sale.reversalReason}”` : ""}. Stock was restored and any udhaar removed. The bill is kept for your records.
        </p>
      )}

      <Card className="print:border-0 print:shadow-none">
        <CardHeader className="border-b pb-4">
          <div>
            <CardTitle className="text-lg">{me.business.name}</CardTitle>
            <p className="text-[12.5px] text-muted-foreground">
              {[me.business.address, me.business.city].filter(Boolean).join(", ")}
              {me.gst.gstin ? ` · GSTIN ${me.gst.gstin}` : ""}
            </p>
          </div>
          <div className="text-right text-[13px]">
            <p className="font-semibold">{customer?.name ?? "Walk-in customer"}</p>
            {customer?.phone && <p className="text-muted-foreground">+91 {customer.phone}</p>}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-muted-foreground">
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 text-right font-medium">Qty</th>
                <th className="hidden pb-2 text-right font-medium sm:table-cell">Rate</th>
                <th className="pb-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="py-2.5 pr-2">
                    <Link href={`/inventory/${i.productId}`} className="font-medium hover:text-primary">
                      {i.productName}
                    </Link>
                    <span className="block text-[12px] text-muted-foreground">
                      {i.gstRateBp ? `GST ${formatGstRate(i.gstRateBp)}` : "No GST"}
                      {i.hsnCode ? ` · HSN ${i.hsnCode}` : ""}
                      {i.discountPaise ? ` · disc. ` : ""}
                      {i.discountPaise ? <Money paise={i.discountPaise} /> : null}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <Qty milli={i.quantityMilli} unit={i.unit} />
                  </td>
                  <td className="hidden py-2.5 text-right sm:table-cell">
                    <Money paise={i.unitPricePaise} />
                  </td>
                  <td className="py-2.5 text-right font-semibold">
                    <Money paise={i.totalPaise} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-3 space-y-1 border-t pt-3 text-[13.5px]">
            <Line label="Items total" v={sale.subtotalPaise} />
            {sale.discountPaise > 0 && <Line label="Discount" v={-sale.discountPaise} />}
            <Line label="Taxable value" v={sale.taxablePaise} muted />
            {sale.isInterstate ? <Line label="IGST" v={sale.igstPaise} muted /> : <><Line label="CGST" v={sale.cgstPaise} muted /><Line label="SGST" v={sale.sgstPaise} muted /></>}
            <div className="flex justify-between pt-1 text-[18px] font-bold">
              <dt>Total</dt>
              <dd>
                <Money paise={sale.totalPaise} />
              </dd>
            </div>
            <Line label={`Paid (${PAYMENT_METHOD_LABELS[sale.paymentMethod as PaymentMethod] ?? sale.paymentMethod})`} v={sale.paidPaise} />
            {sale.creditPaise > 0 && <Line label="Udhaar (on khata)" v={sale.creditPaise} warn />}
            {can("reports.view") && sale.costPaise !== null && (
              <Line label="Profit on this bill" v={sale.taxablePaise - (sale.costPaise ?? 0)} muted />
            )}
          </dl>
          {sale.notes && <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-[13px]">{sale.notes}</p>}
        </CardContent>
      </Card>

      {payments.length > 0 && (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Payment recorded: {payments.map((p) => `${PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method} ${p.status === "REVERSED" ? "(reversed)" : ""}`).join(", ")}
          {customer && (
            <>
              {" · "}
              <Link className="text-primary hover:underline" href={`/customers/${customer.id}`}>
                Open {customer.name}&apos;s khata
              </Link>
            </>
          )}
        </p>
      )}

      <ConfirmDialog
        open={undo}
        onOpenChange={setUndo}
        title={`Undo ${sale.invoiceNumber}?`}
        description="The bill stays in your records marked “reversed”. Stock goes back and any udhaar is removed from the khata."
        confirmLabel="Undo sale"
        destructive
        askReason
        onConfirm={async (reason) => {
          try {
            await api(`/sales/${id}/reverse`, { method: "POST", body: { reason }, idempotencyKey: `reverse-sale-${id}` });
            toast.success("Sale reversed. Stock restored.");
            await qc.invalidateQueries();
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </div>
  );
}

function Line({ label, v, muted, warn }: { label: string; v: number; muted?: boolean; warn?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""} ${warn ? "font-semibold text-warning-foreground" : ""}`}>
      <dt>{label}</dt>
      <dd>
        <Money paise={v} />
      </dd>
    </div>
  );
}

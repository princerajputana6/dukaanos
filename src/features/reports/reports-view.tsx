"use client";
import { useQuery } from "@tanstack/react-query";
import { BarChart3Icon, DownloadIcon, LockIcon } from "lucide-react";
import Link from "next/link";
import { DailyBars, RankedBars, TrendChart } from "@/components/charts/charts";
import { DateRangePicker, presetRange } from "@/components/shared/date-range";
import { Money, Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { CardsSkeleton, EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCan } from "@/features/session/session-context";
import { apiGet, qs } from "@/lib/api";
import type { ExpensesReport, GstSummary, InventoryValuation, LowStockItem, OutstandingRow, ProfitReport, SalesReport, TopProduct } from "@/lib/api-types";
import { formatRelative } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { formatGstRate } from "@/lib/pricing";
import { formatQty } from "@/lib/qty";

const TABS = [
  { id: "sales", label: "Sales", ranged: true },
  { id: "profit", label: "Profit", ranged: true },
  { id: "expenses", label: "Expenses", ranged: true },
  { id: "top-products", label: "Top products", ranged: true },
  { id: "inventory", label: "Inventory value", ranged: false },
  { id: "low-stock", label: "Low stock", ranged: false },
  { id: "customer-outstanding", label: "Customer dues", ranged: false },
  { id: "supplier-outstanding", label: "Supplier dues", ranged: false },
  { id: "gst", label: "GST", ranged: true },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function ReportsView() {
  const can = useCan();
  const url = useUrlState();
  const tab = (url.get("tab") as TabId) ?? "sales";
  const def = presetRange("30d");
  const range = { from: url.get("from") ?? def.from, to: url.get("to") ?? def.to };
  const meta = TABS.find((t) => t.id === tab) ?? TABS[0];

  if (!can("reports.view")) {
    return <EmptyState icon={LockIcon} title="Reports are for owners and managers." description="Ask the shop owner for access." />;
  }
  return (
    <div>
      <PageHeader
        title="Reports"
        description="Calculated live from your transactions."
        actions={
          <Button variant="outline" asChild>
            <a href={`/api/reports/export/${tab}${qs(range)}`} download>
              <DownloadIcon /> Export CSV
            </a>
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === "sales" ? null : v })}>
        <TabsList className="-mx-4 mb-4 w-[calc(100%+2rem)] justify-start rounded-none bg-transparent px-4 sm:mx-0 sm:w-auto sm:rounded-xl sm:bg-muted sm:px-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="flex-none data-[state=inactive]:bg-muted/60 sm:data-[state=inactive]:bg-transparent">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {meta.ranged && <DateRangePicker className="mb-4" value={range} onChange={(r) => url.set({ from: r.from, to: r.to })} />}
      {tab === "sales" && <SalesTab range={range} />}
      {tab === "profit" && <ProfitTab range={range} />}
      {tab === "expenses" && <ExpensesTab range={range} />}
      {tab === "top-products" && <TopTab range={range} />}
      {tab === "inventory" && <InventoryTab />}
      {tab === "low-stock" && <LowTab />}
      {tab === "customer-outstanding" && <DuesTab kind="customer" />}
      {tab === "supplier-outstanding" && <DuesTab kind="supplier" />}
      {tab === "gst" && <GstTab range={range} />}
    </div>
  );
}

type Range = { from: string; to: string };
function useReport<T>(path: string, range?: Range) {
  return useQuery({ queryKey: ["reports", path, range?.from, range?.to], queryFn: ({ signal }) => apiGet<T>(`/reports/${path}${range ? qs(range) : ""}`, signal) });
}
function Loading({ q }: { q: { isError: boolean; error: unknown; refetch: () => unknown } }) {
  return q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <CardsSkeleton />;
}

function SalesTab({ range }: { range: Range }) {
  const q = useReport<SalesReport>("sales", range);
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sales" value={<Money paise={d.totals.totalPaise} compact />} />
        <StatCard label="Bills" value={d.totals.orders} hint={d.totals.orders ? <>Avg <Money paise={Math.round(d.totals.totalPaise / d.totals.orders)} compact /></> : undefined} />
        <StatCard label="Discounts" value={<Money paise={d.totals.discountPaise} compact />} />
        <StatCard label="On udhaar" value={<Money paise={d.totals.creditPaise} compact />} tone="warning" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Daily sales</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart data={d.series.map((s) => ({ date: s.date, value: s.totalPaise }))} valueLabel="Sales" height={240} />
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Money received by method</CardTitle>
          </CardHeader>
          <CardContent>
            {d.byMethod.length ? (
              <RankedBars items={d.byMethod.map((m) => ({ label: PAYMENT_METHOD_LABELS[m.method as PaymentMethod] ?? m.method, value: m.totalPaise }))} formatValue={(v) => formatMoney(v, { compact: true })} />
            ) : (
              <p className="text-sm text-muted-foreground">No payments in this period.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
          </CardHeader>
          <CardContent>
            <TopList items={d.topProducts.slice(0, 6)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TopList({ items }: { items: TopProduct[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No sales in this period.</p>;
  return <RankedBars items={items.map((t) => ({ label: t.name, value: t.revenuePaise, sub: `${formatQty(t.quantityMilli)} ${t.unit} · profit ${formatMoney(t.profitPaise, { compact: true })}` }))} formatValue={(v) => formatMoney(v, { compact: true })} />;
}

function ProfitTab({ range }: { range: Range }) {
  const q = useReport<ProfitReport>("profit", range);
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue (before GST)" value={<Money paise={d.revenuePaise} compact />} />
        <StatCard label="Gross profit" value={<Money paise={d.grossProfitPaise} compact />} tone="success" hint={`${d.grossMarginPct}% margin`} />
        <StatCard label="Expenses" value={<Money paise={d.expensesPaise} compact />} tone="warning" />
        <StatCard label="Net profit" value={<Money paise={d.netProfitPaise} compact />} tone={d.netProfitPaise >= 0 ? "success" : "danger"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Net profit by day</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart data={d.series.map((s) => ({ date: s.date, value: s.netProfitPaise }))} valueLabel="Net profit" height={240} color="var(--chart-1)" />
        </CardContent>
      </Card>
      <p className="text-[12.5px] text-muted-foreground">
        Gross profit = sales value before GST − cost of goods sold (weighted average purchase cost). Net profit also subtracts expenses.
      </p>
    </div>
  );
}

function ExpensesTab({ range }: { range: Range }) {
  const q = useReport<ExpensesReport>("expenses", range);
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Expenses by day</CardTitle>
          <Money paise={d.totalPaise} className="font-semibold" />
        </CardHeader>
        <CardContent>
          <DailyBars data={d.series.map((s) => ({ date: s.date, value: s.totalPaise }))} valueLabel="Expenses" height={240} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>By category</CardTitle>
        </CardHeader>
        <CardContent>
          {d.byCategory.length ? (
            <RankedBars items={d.byCategory.map((c) => ({ label: c.category, value: c.totalPaise, sub: `${c.count} entries` }))} formatValue={(v) => formatMoney(v, { compact: true })} />
          ) : (
            <p className="text-sm text-muted-foreground">No expenses in this period.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TopTab({ range }: { range: Range }) {
  const q = useReport<TopProduct[]>("top-products", range);
  if (!q.data) return <Loading q={q} />;
  return (
    <Card>
      <CardContent className="pt-5">
        <TopList items={q.data} />
      </CardContent>
    </Card>
  );
}

function InventoryTab() {
  const q = useReport<InventoryValuation>("inventory");
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Stock value (at cost)" value={<Money paise={d.totals.costValuePaise} compact />} />
        <StatCard label="Stock value (at selling price)" value={<Money paise={d.totals.retailValuePaise} compact />} />
        <StatCard label="Products" value={d.totals.products} />
      </div>
      <Table
        head={["Product", "Stock", "Avg cost", "Value"]}
        rows={d.items.map((i) => [
          <Link key="n" href={`/inventory/${i.id}`} className="font-medium hover:text-primary">{i.name}</Link>,
          <Qty key="s" milli={i.stockMilli} unit={i.unit} />,
          <Money key="c" paise={i.avgCostPaise} />,
          <Money key="v" paise={i.costValuePaise} className="font-semibold" />,
        ])}
      />
    </div>
  );
}

function LowTab() {
  const q = useQuery({ queryKey: ["inventory", "low-stock"], queryFn: ({ signal }) => apiGet<LowStockItem[]>("/inventory/low-stock", signal) });
  if (!q.data) return q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <ListSkeleton />;
  if (!q.data.length) return <EmptyState icon={BarChart3Icon} title="Nothing is running low." />;
  return (
    <Table
      head={["Product", "Stock", "Alert at", "Reorder"]}
      rows={q.data.map((i) => [
        <Link key="n" href={`/inventory/${i.id}`} className="font-medium hover:text-primary">{i.name}</Link>,
        <Qty key="s" milli={Math.max(0, i.currentStockMilli)} unit={i.unit} />,
        <Qty key="t" milli={i.lowStockThresholdMilli} />,
        <Qty key="r" milli={i.suggestedReorderMilli} unit={i.unit} className="font-semibold text-primary" />,
      ])}
    />
  );
}

function DuesTab({ kind }: { kind: "customer" | "supplier" }) {
  const q = useReport<OutstandingRow[]>(kind === "customer" ? "customer-outstanding" : "supplier-outstanding");
  if (!q.data) return <Loading q={q} />;
  if (!q.data.length) return <EmptyState icon={BarChart3Icon} title={kind === "customer" ? "No customer udhaar pending." : "You don't owe any supplier."} />;
  const total = q.data.reduce((a, r) => a + r.balancePaise, 0);
  return (
    <div className="space-y-3">
      <StatCard label={kind === "customer" ? "Total to collect" : "Total payable"} value={<Money paise={total} />} tone="warning" />
      <Table
        head={["Name", "Phone", "Last activity", "Amount"]}
        rows={q.data.map((r) => [
          <Link key="n" href={`/${kind}s/${r.id}`} className="font-medium hover:text-primary">{r.name}</Link>,
          r.phone ?? "—",
          r.lastTxnAt ? formatRelative(r.lastTxnAt) : "—",
          <Money key="a" paise={r.balancePaise} className="font-semibold" />,
        ])}
      />
    </div>
  );
}

function GstTab({ range }: { range: Range }) {
  const q = useReport<GstSummary>("gst", range);
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  const rows = (list: GstSummary["output"]) =>
    list.map((x) => [formatGstRate(x.rateBp), <Money key="t" paise={x.taxablePaise} />, <Money key="c" paise={x.cgstPaise + x.sgstPaise} />, <Money key="i" paise={x.igstPaise} />, <Money key="x" paise={x.taxPaise} className="font-semibold" />]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Output tax (sales)" value={<Money paise={d.outputTaxPaise} compact />} />
        <StatCard label="Input tax (purchases)" value={<Money paise={d.inputTaxPaise} compact />} />
        <StatCard label="Net GST payable" value={<Money paise={d.netPayablePaise} compact />} tone={d.netPayablePaise > 0 ? "warning" : "success"} />
      </div>
      <h3 className="text-[14px] font-semibold">Sales (output)</h3>
      <Table head={["Rate", "Taxable", "CGST+SGST", "IGST", "Tax"]} rows={rows(d.output)} />
      <h3 className="text-[14px] font-semibold">Purchases (input)</h3>
      <Table head={["Rate", "Taxable", "CGST+SGST", "IGST", "Tax"]} rows={rows(d.input)} />
      <p className="text-[12.5px] text-muted-foreground">A summary to help you or your CA — not a GST return filing.</p>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">No data for this period.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[480px] text-[14px]">
        <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-2.5 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2.5 ${j > 0 ? "text-right" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

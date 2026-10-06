"use client";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  BookUserIcon,
  IndianRupeeIcon,
  LightbulbIcon,
  MicIcon,
  PackageIcon,
  PackagePlusIcon,
  ReceiptIcon,
  ShoppingBagIcon,
  SlidersHorizontalIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { DailyBars, RankedBars, TrendChart } from "@/components/charts/charts";
import { Money, Qty } from "@/components/shared/money";
import { CardsSkeleton, ErrorState } from "@/components/shared/states";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InstallPrompt } from "@/features/pwa/pwa";
import { useCan, useSession } from "@/features/session/session-context";
import { useVoiceStore } from "@/features/voice/voice-store";
import { VOICE_EXAMPLES } from "@/features/voice/voice-sheet";
import { apiGet } from "@/lib/api";
import type { Dashboard } from "@/lib/api-types";
import { formatDate, greeting } from "@/lib/dates";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { formatQty } from "@/lib/qty";
import { cn } from "@/lib/utils";

export function DashboardView() {
  const me = useSession();
  const can = useCan();
  const openVoice = useVoiceStore((s) => s.openSheet);
  const q = useQuery({ queryKey: ["dashboard"], queryFn: ({ signal }) => apiGet<Dashboard>("/reports/dashboard", signal), refetchInterval: 60_000 });
  const d = q.data;

  const quick = [
    { label: "Sale", href: "/sales/new", icon: ReceiptIcon, show: can("sales.create") },
    { label: "Purchase", href: "/purchases/new", icon: ShoppingBagIcon, show: can("purchase.create") },
    { label: "Add Product", href: "/products/new", icon: PackagePlusIcon, show: can("inventory.create") },
    { label: "Add Customer", href: "/customers?new=1", icon: BookUserIcon, show: can("customer.create") },
    { label: "Add Expense", href: "/expenses?new=1", icon: WalletIcon, show: can("expense.create") },
    { label: "Stock Adjust", href: "/inventory?adjust=1", icon: SlidersHorizontalIcon, show: can("inventory.adjust") },
  ].filter((a) => a.show);

  const salesDelta = d && d.yesterday.salesPaise > 0 ? Math.round(((d.today.salesPaise - d.yesterday.salesPaise) / d.yesterday.salesPaise) * 100) : null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-medium text-muted-foreground">{d ? formatDate(d.date) : "\u00a0"}</p>
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight sm:text-[26px]">
          {greeting()}, {me.business.name} <span aria-hidden="true">👋</span>
        </h1>
      </div>

      <InstallPrompt />

      {/* Voice CTA — the core loop */}
      <section className="relative overflow-hidden rounded-3xl bg-brand p-5 text-brand-foreground shadow-lift sm:p-6">
        <div aria-hidden="true" className="absolute -top-16 -right-10 size-56 rounded-full bg-white/[0.06]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] font-medium text-brand-foreground/75">Run your shop by speaking</p>
            <button
              type="button"
              onClick={() => openVoice({ listen: true })}
              className="mt-2 inline-flex h-14 items-center gap-3 rounded-2xl bg-white px-5 text-[16px] font-semibold text-brand shadow-sm transition-transform active:scale-[0.98]"
            >
              <MicIcon className="size-5" aria-hidden="true" /> Talk to DukaanOS
            </button>
          </div>
          <ul className="flex flex-wrap gap-2 sm:max-w-sm sm:justify-end">
            {VOICE_EXAMPLES.slice(0, 3).map((ex) => (
              <li key={ex} className="rounded-full bg-white/12 px-3 py-1.5 text-[13px] text-brand-foreground/90">
                “{ex}”
              </li>
            ))}
          </ul>
        </div>
      </section>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <CardsSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Today's Sales"
            value={<Money paise={d.today.salesPaise} compact />}
            icon={IndianRupeeIcon}
            href="/sales"
            hint={
              <span className="inline-flex items-center gap-1">
                {d.today.orders} bill{d.today.orders === 1 ? "" : "s"}
                {salesDelta !== null && (
                  <span className={cn("inline-flex items-center font-semibold", salesDelta >= 0 ? "text-success" : "text-destructive")}>
                    {salesDelta >= 0 ? <ArrowUpRightIcon className="size-3" /> : <ArrowDownRightIcon className="size-3" />}
                    {Math.abs(salesDelta)}% vs yday
                  </span>
                )}
              </span>
            }
          />
          {d.today.grossProfitPaise !== null ? (
            <StatCard
              label="Today's Profit"
              value={<Money paise={d.today.grossProfitPaise} compact />}
              icon={TrendingUpIcon}
              tone="success"
              href="/reports?tab=profit"
              hint={d.today.expensesPaise ? `Net ${formatMoney(d.today.netProfitPaise ?? 0, { compact: true })} after expenses` : "Before expenses"}
            />
          ) : (
            <StatCard label="Bills today" value={d.today.orders} icon={ReceiptIcon} href="/sales" />
          )}
          <StatCard
            label="Outstanding"
            value={d.outstanding ? <Money paise={d.outstanding.receivablePaise} compact /> : "—"}
            icon={BookUserIcon}
            tone="warning"
            href="/customers?filter=outstanding"
            hint={d.outstanding ? `${d.outstanding.customersWithDues} customer${d.outstanding.customersWithDues === 1 ? "" : "s"} owe you` : undefined}
          />
          <StatCard
            label="Low Stock"
            value={d.lowStock.count}
            icon={AlertTriangleIcon}
            tone={d.lowStock.count ? "danger" : "default"}
            href="/inventory?stock=low"
            hint={d.lowStock.count ? `${d.lowStock.count} product${d.lowStock.count === 1 ? " needs" : "s need"} attention` : "All good"}
          />
        </div>
      )}

      {quick.length > 0 && (
        <nav aria-label="Quick actions" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:grid sm:grid-cols-6 sm:px-0">
          {quick.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex min-w-[88px] shrink-0 flex-col items-center gap-2 rounded-2xl border bg-card px-3 py-3.5 text-center text-[12.5px] font-semibold shadow-soft transition-colors hover:border-primary/30"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <a.icon className="size-5" aria-hidden="true" />
              </span>
              {a.label}
            </Link>
          ))}
        </nav>
      )}

      {d && d.insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LightbulbIcon className="size-4 text-warning" aria-hidden="true" /> Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {d.insights.map((i) => {
                const body = (
                  <span className="flex items-center gap-3 py-2.5 text-[14px]">
                    <span
                      aria-hidden="true"
                      className={cn("size-2 shrink-0 rounded-full", { positive: "bg-success", negative: "bg-destructive", warning: "bg-warning", neutral: "bg-info" }[i.tone])}
                    />
                    <span className="flex-1">{i.text}</span>
                  </span>
                );
                return <li key={i.id}>{i.link ? <Link href={i.link} className="block hover:text-primary">{body}</Link> : body}</li>;
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Sales trend</CardTitle>
              <CardDescription>Last 14 days</CardDescription>
            </div>
            {d && <Money paise={d.salesTrend.reduce((a, x) => a + x.totalPaise, 0)} compact className="text-[15px] font-semibold" />}
          </CardHeader>
          <CardContent>{d ? <TrendChart data={d.salesTrend.map((x) => ({ date: x.date, value: x.totalPaise }))} valueLabel="Sales" /> : <Skeleton className="h-[200px]" />}</CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Top products</CardTitle>
              <CardDescription>Last 7 days, by revenue</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {!d ? (
              <Skeleton className="h-[200px]" />
            ) : d.topProducts.length ? (
              <RankedBars
                items={d.topProducts.map((t) => ({ label: t.name, value: t.revenuePaise, sub: `${formatQty(t.quantityMilli)} ${t.unit} sold`, href: `/inventory/${t.productId}` }))}
                formatValue={(v) => formatMoney(v, { compact: true })}
              />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Your first sale will appear here.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {d && d.lowStock.count > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{d.lowStock.count} products need attention</CardTitle>
              <Link href="/inventory?stock=low" className="text-[13px] font-semibold text-primary hover:underline">
                View all
              </Link>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {d.lowStock.items.map((p) => (
                  <li key={p.id}>
                    <Link href={`/inventory/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <PackageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate text-[14px] font-medium">{p.name}</span>
                      </span>
                      <span className="text-right text-[12.5px]">
                        <Qty milli={Math.max(0, p.currentStockMilli)} unit={p.unit} className={p.currentStockMilli <= 0 ? "font-semibold text-destructive" : "font-semibold"} />
                        <span className="block text-muted-foreground">reorder ~{formatQty(p.suggestedReorderMilli)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {d && can("reports.view") && d.expenseTrend.length > 0 && (
          <Card className={d.lowStock.count > 0 ? "lg:col-span-3" : "lg:col-span-5"}>
            <CardHeader>
              <div>
                <CardTitle>Expense trend</CardTitle>
                <CardDescription>Last 30 days</CardDescription>
              </div>
              <span className="text-[15px] font-semibold">{formatMoneyShort(d.expenseTrend.reduce((a, x) => a + x.totalPaise, 0))}</span>
            </CardHeader>
            <CardContent>
              <DailyBars data={d.expenseTrend.map((x) => ({ date: x.date, value: x.totalPaise }))} valueLabel="Expenses" />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

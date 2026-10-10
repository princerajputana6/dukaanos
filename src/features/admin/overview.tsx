"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, BuildingIcon, HandshakeIcon, IndianRupeeIcon, PlusCircleIcon, StoreIcon, UsersIcon, ZapIcon } from "lucide-react";
import Link from "next/link";
import { RankedBars } from "@/components/charts/charts";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { CardsSkeleton, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api";
import type { AdminOverview } from "@/lib/api-types";
import { LICENSE_PLANS, LICENSE_STATUS_LABELS, type LicensePlan, type LicenseStatus } from "@/lib/domain";
import { formatShortDate } from "@/lib/dates";

export function AdminOverviewView() {
  const q = useQuery({ queryKey: ["admin", "overview"], queryFn: ({ signal }) => apiGet<AdminOverview>("/admin/overview", signal) });
  const d = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform overview"
        description="Every tenant, shop, branch and licence on DukaanOS."
        actions={
          <Button asChild>
            <Link href="/admin/shops/new">
              <PlusCircleIcon /> Create shop
            </Link>
          </Button>
        }
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <CardsSkeleton count={8} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Tenants (accounts)" value={d.counts.tenants} icon={BuildingIcon} href="/admin/tenants" hint={d.counts.suspendedTenants ? `${d.counts.suspendedTenants} suspended` : "All in good standing"} />
            <StatCard label="Shops registered" value={d.counts.shops} icon={StoreIcon} href="/admin/shops" hint={`${d.counts.branches} additional branch${d.counts.branches === 1 ? "" : "es"}`} />
            <StatCard label="Agencies" value={d.counts.agencies} icon={HandshakeIcon} href="/admin/agencies" />
            <StatCard label="Owners / users" value={`${d.counts.owners} / ${d.counts.users}`} icon={UsersIcon} href="/admin/users" hint={`${d.counts.superAdmins} super admin${d.counts.superAdmins === 1 ? "" : "s"}`} />
            <StatCard label="Active shops (7 days)" value={d.counts.activeShops7d} icon={ZapIcon} tone="success" hint="Recorded at least one sale" />
            <StatCard label="Licences expiring ≤ 7 days" value={d.licenses.expiringSoon} icon={AlertTriangleIcon} tone={d.licenses.expiringSoon ? "warning" : "default"} href="/admin/tenants?status=EXPIRING" />
            <StatCard label="Platform sales today" value={<Money paise={d.gmv.todayPaise} compact />} icon={IndianRupeeIcon} />
            <StatCard label="Platform sales (30 days)" value={<Money paise={d.gmv.last30Paise} compact />} icon={IndianRupeeIcon} hint={`${d.gmv.bills30.toLocaleString("en-IN")} bills`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Licences by status</CardTitle>
                  <CardDescription>Effective today</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-[14px]">
                  {(Object.keys(d.licenses.byStatus) as LicenseStatus[]).map((s) => (
                    <li key={s}>
                      <Link href={`/admin/tenants?status=${s === "ACTIVE" ? "" : s}`} className="flex justify-between py-2 hover:text-primary">
                        <span>{LICENSE_STATUS_LABELS[s]}</span>
                        <span className="font-semibold">{d.licenses.byStatus[s]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Licences by plan</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(d.licenses.byPlan).length ? (
                  <RankedBars items={Object.entries(d.licenses.byPlan).map(([plan, n]) => ({ label: LICENSE_PLANS[plan as LicensePlan]?.label ?? plan, value: n }))} formatValue={(v) => String(v)} />
                ) : (
                  <p className="text-sm text-muted-foreground">No licences yet.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>New tenants</CardTitle>
                  <CardDescription>Last 30 days</CardDescription>
                </div>
                <span className="font-semibold">{d.signups.reduce((a, s) => a + s.value, 0)}</span>
              </CardHeader>
              <CardContent>
                <div className="flex h-32 items-end gap-[2px]" role="img" aria-label="New tenants per day, last 30 days">
                  {d.signups.map((s) => {
                    const max = Math.max(1, ...d.signups.map((x) => x.value));
                    return <div key={s.date} title={`${formatShortDate(s.date)}: ${s.value}`} className="flex-1 rounded-t-[3px] bg-chart-1" style={{ height: `${Math.max(3, (s.value / max) * 100)}%`, opacity: s.value ? 1 : 0.25 }} />;
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                  <span>{formatShortDate(d.signups[0]!.date)}</span>
                  <span>Today</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

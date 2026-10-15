"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, ArrowRightIcon, CheckCircle2Icon, InfoIcon, LightbulbIcon, XIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PageHeader } from "@/components/shared/page-header";
import { CardsSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Insight {
  id: string;
  kind: string;
  severity: "alert" | "warning" | "info";
  title: string;
  detail: string;
  evidence: string;
  href: string | null;
  actionLabel: string | null;
}

const DISMISS_KEY = "suvakta:insights-dismissed";

const SEV = {
  alert: { ring: "border-destructive/30", chip: "bg-destructive-soft text-destructive", Icon: AlertTriangleIcon },
  warning: { ring: "border-warning/30", chip: "bg-warning-soft text-warning-foreground", Icon: AlertTriangleIcon },
  info: { ring: "border-info/30", chip: "bg-info-soft text-info", Icon: InfoIcon },
} as const;

export function InsightsView() {
  const q = useQuery({ queryKey: ["insights"], queryFn: ({ signal }) => apiGet<Insight[]>("/reports/insights", signal) });
  // Lazy, SSR-safe init (localStorage only exists in the browser); no effect needed.
  const [dismissed, setDismissed] = React.useState<Record<string, number>>(() => {
    try {
      return typeof window === "undefined" ? {} : (JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}") as Record<string, number>);
    } catch {
      return {};
    }
  });
  const [showAll, setShowAll] = React.useState(false);

  const dismiss = (id: string) => {
    const next = { ...dismissed, [id]: 1 };
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setDismissed(next);
  };
  const restore = () => {
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* ignore */
    }
    setDismissed({});
    setShowAll(false);
  };

  const all = q.data ?? [];
  const visible = showAll ? all : all.filter((i) => !dismissed[i.id]);
  const hiddenCount = all.length - all.filter((i) => !dismissed[i.id]).length;

  return (
    <div>
      <PageHeader
        title="Insights"
        description="Things worth your attention, found in your own data. Each one shows its evidence — nothing is guessed, and nothing changes until you act."
        actions={hiddenCount > 0 ? <Button variant="ghost" size="sm" onClick={showAll ? restore : () => setShowAll(true)}>{showAll ? "Reset dismissed" : `Show dismissed (${hiddenCount})`}</Button> : undefined}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <CardsSkeleton count={4} />
      ) : visible.length === 0 ? (
        <EmptyState icon={CheckCircle2Icon} title="All clear." description="No issues found in your recent sales, stock, cash or khata. Check back later." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((i) => {
            const s = SEV[i.severity];
            const isDismissed = !!dismissed[i.id];
            return (
              <div key={i.id} className={cn("flex flex-col rounded-2xl border bg-card p-4", s.ring, isDismissed && "opacity-60")}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className={cn("flex size-8 items-center justify-center rounded-xl", s.chip)}>
                    <s.Icon className="size-4" aria-hidden="true" />
                  </span>
                  {!isDismissed && (
                    <button type="button" aria-label="Dismiss" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" onClick={() => dismiss(i.id)}>
                      <XIcon className="size-4" />
                    </button>
                  )}
                </div>
                <h3 className="text-[15px] font-semibold">{i.title}</h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{i.detail}</p>
                <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px] font-medium">{i.evidence}</p>
                {i.href && i.actionLabel && (
                  <Link href={i.href} className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-primary hover:underline">
                    {i.actionLabel} <ArrowRightIcon className="size-3.5" />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!q.isLoading && all.length > 0 && (
        <p className="mt-6 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <LightbulbIcon className="size-3.5" aria-hidden="true" /> Insights are read-only observations from rules on your data — they never change prices, stock, credit or orders.
        </p>
      )}
    </div>
  );
}

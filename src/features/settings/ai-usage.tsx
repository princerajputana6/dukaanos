"use client";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Money } from "@/components/shared/money";
import { CardsSkeleton, ErrorState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api";

interface OwnUsage {
  monthSpendMicros: number;
  monthCapMicros: number | null;
  killSwitch: boolean;
  pctUsed: number | null;
  callsThisMonth: number;
  byTask: { task: string; costMicros: number; calls: number }[];
}
const TASK: Record<string, string> = { stt: "Speech recognition", intent: "Voice understanding", answer: "Answers", insight: "Insights" };
const paise = (micros: number) => Math.round(micros / 10000);

export function AiUsageSettings() {
  const q = useQuery({ queryKey: ["business", "ai-usage"], queryFn: ({ signal }) => apiGet<OwnUsage>("/business/ai-usage", signal) });
  const d = q.data;
  return (
    <div>
      <PageHeader title="AI usage" description="Your voice and AI usage this month. Core billing and stock always work, even if the AI limit is reached." back={{ href: "/settings", label: "Settings" }} />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <CardsSkeleton count={2} />
      ) : (
        <div className="max-w-xl space-y-4">
          <div className="rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-muted-foreground">This month</p>
              {d.killSwitch ? <Badge variant="danger">AI turned off</Badge> : d.monthCapMicros ? <Badge variant="neutral">Limit <Money paise={paise(d.monthCapMicros)} compact /></Badge> : <Badge variant="success">No limit</Badge>}
            </div>
            <p className="mt-1 text-[28px] font-bold"><Money paise={paise(d.monthSpendMicros)} /></p>
            <p className="text-[12.5px] text-muted-foreground">{d.callsThisMonth} AI request{d.callsThisMonth === 1 ? "" : "s"}</p>
            {d.pctUsed != null && (
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[12px] text-muted-foreground">
                  <span>{d.pctUsed}% of limit used</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${d.pctUsed >= 100 ? "bg-destructive" : d.pctUsed >= 80 ? "bg-warning" : "bg-primary"}`} style={{ width: `${Math.min(100, d.pctUsed)}%` }} />
                </div>
              </div>
            )}
          </div>

          {d.byTask.length > 0 && (
            <div className="rounded-2xl border bg-card p-5">
              <p className="mb-2 text-[13px] font-semibold">Breakdown</p>
              <ul className="space-y-2">
                {d.byTask.map((t) => (
                  <li key={t.task} className="flex items-center justify-between text-[14px]">
                    <span>{TASK[t.task] ?? t.task}</span>
                    <span className="text-muted-foreground">{t.calls} · <Money paise={paise(t.costMicros)} className="font-medium text-foreground" /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[12px] text-muted-foreground">Amounts are estimates for your reference. To change your AI limit, contact Suvakta.</p>
        </div>
      )}
    </div>
  );
}

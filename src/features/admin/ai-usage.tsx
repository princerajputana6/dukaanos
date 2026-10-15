"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BanIcon, BotIcon, CircleAlertIcon, CoinsIcon, MicIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Field } from "@/components/shared/field";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { CardsSkeleton, ErrorState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { api, apiGet, errorMessage } from "@/lib/api";

interface TopBiz {
  businessId: string;
  name: string;
  calls: number;
  costMicros: number;
  monthlyCapMicros: number | null;
  killSwitch: boolean;
}
interface AiUsage {
  days: number;
  priceVersion: string;
  totals: { calls: number; costMicros: number; inputTokens: number; outputTokens: number; audioMs: number; errors: number; retries: number; businesses: number; costPer1kCallsMicros: number };
  byTask: { task: string; calls: number; costMicros: number }[];
  byModel: { model: string; calls: number; costMicros: number }[];
  topBusinesses: TopBiz[];
}

/** Micro-rupees → "₹1.2345". Costs are tiny, so show up to 4 decimals. */
function rupees(micros: number): string {
  const r = micros / 1_000_000;
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: r < 100 ? 4 : 2, maximumFractionDigits: 4 })}`;
}
const TASK_LABEL: Record<string, string> = { stt: "Speech (STT)", intent: "Intent (LLM)", answer: "Answers", insight: "Insights" };

export function AiUsageView() {
  const [days, setDays] = React.useState(30);
  const [edit, setEdit] = React.useState<TopBiz | null>(null);
  const q = useQuery({ queryKey: ["admin", "ai-usage", days], queryFn: ({ signal }) => apiGet<AiUsage>(`/admin/ai-usage?days=${days}`, signal) });
  const d = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="AI usage & cost"
        description="Estimated Workers AI spend across all shops. Deterministic rules handle most commands for free; the LLM is a fallback."
        actions={
          <div className="flex gap-1.5" role="group" aria-label="Period">
            {[7, 30, 90].map((n) => (
              <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={`h-9 rounded-full border px-3.5 text-[13px] font-medium ${days === n ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent"}`}>
                {n}d
              </button>
            ))}
          </div>
        }
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <CardsSkeleton count={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={`AI cost (${d.days}d)`} value={rupees(d.totals.costMicros)} icon={CoinsIcon} tone="success" hint={`${d.totals.businesses} shop${d.totals.businesses === 1 ? "" : "s"} · price ${d.priceVersion}`} />
            <StatCard label="Provider calls" value={d.totals.calls.toLocaleString("en-IN")} icon={BotIcon} hint={`${rupees(d.totals.costPer1kCallsMicros)} / 1,000 calls`} />
            <StatCard label="Speech minutes" value={Math.round(d.totals.audioMs / 60000).toLocaleString("en-IN")} icon={MicIcon} hint={`${(d.totals.inputTokens + d.totals.outputTokens).toLocaleString("en-IN")} LLM tokens`} />
            <StatCard label="Errors / retries" value={`${d.totals.errors} / ${d.totals.retries}`} icon={CircleAlertIcon} tone={d.totals.errors ? "warning" : "default"} hint="failed or retried calls" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By task</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {d.byTask.length === 0 ? <p className="text-[13.5px] text-muted-foreground">No AI calls in this period.</p> : d.byTask.map((t) => (
                  <div key={t.task} className="flex items-center justify-between text-[14px]">
                    <span>{TASK_LABEL[t.task] ?? t.task}</span>
                    <span className="text-muted-foreground">{t.calls.toLocaleString("en-IN")} calls · <span className="font-semibold text-foreground">{rupees(t.costMicros)}</span></span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>By model</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {d.byModel.length === 0 ? <p className="text-[13.5px] text-muted-foreground">No AI calls in this period.</p> : d.byModel.map((m) => (
                  <div key={m.model} className="flex items-center justify-between gap-3 text-[14px]">
                    <span className="min-w-0 truncate font-mono text-[12.5px]">{m.model}</span>
                    <span className="whitespace-nowrap text-muted-foreground">{m.calls.toLocaleString("en-IN")} · <span className="font-semibold text-foreground">{rupees(m.costMicros)}</span></span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Top shops by AI spend</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {d.topBusinesses.length === 0 ? (
                <p className="px-6 text-[13.5px] text-muted-foreground">No AI usage yet.</p>
              ) : (
                <ul className="divide-y">
                  {d.topBusinesses.map((b) => (
                    <li key={b.businessId} className="flex flex-wrap items-center gap-3 px-6 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[14.5px] font-semibold">
                          {b.name}
                          {b.killSwitch && (
                            <Badge variant="danger">
                              <BanIcon /> AI off
                            </Badge>
                          )}
                          {b.monthlyCapMicros != null && !b.killSwitch && <Badge variant="neutral">cap {rupees(b.monthlyCapMicros)}/mo</Badge>}
                        </p>
                        <p className="text-[12.5px] text-muted-foreground">{b.calls.toLocaleString("en-IN")} calls · {rupees(b.costMicros)}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setEdit(b)}>
                        Budget
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <p className="text-[12px] text-muted-foreground">Costs are budgeting estimates (price version {d.priceVersion}), not a provider invoice. Core billing and stock keep working even when a shop’s AI budget is exhausted.</p>
        </>
      )}
      <BudgetEditor key={edit?.businessId ?? "none"} biz={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function BudgetEditor({ biz, onClose }: { biz: TopBiz | null; onClose: () => void }) {
  const qc = useQueryClient();
  // Keyed by businessId in the parent, so it remounts per shop and starts from that shop's values.
  const [cap, setCap] = React.useState(biz?.monthlyCapMicros == null ? "" : String(biz.monthlyCapMicros / 1_000_000));
  const [kill, setKill] = React.useState(biz?.killSwitch ?? false);
  const [busy, setBusy] = React.useState(false);
  return (
    <ResponsiveModal open={!!biz} onOpenChange={(o) => !o && onClose()} title={`AI budget — ${biz?.name ?? ""}`} description="Cap monthly AI spend or turn AI off for this shop. Billing and stock are never affected.">
      {biz && (
        <div className="space-y-4 pb-2">
          <Field id="cap" label="Monthly cap (₹)" hint="Leave empty for no cap. When reached, AI pauses for the month; the shop keeps billing by typing/tapping." optional>
            <Input id="cap" inputMode="decimal" placeholder="e.g. 200" value={cap} onChange={(e) => setCap(e.target.value)} disabled={kill} />
          </Field>
          <label className="flex items-center gap-3 rounded-xl border p-3">
            <input type="checkbox" className="size-4 accent-[var(--destructive)]" checked={kill} onChange={(e) => setKill(e.target.checked)} />
            <span className="text-[14px]">
              <span className="font-semibold">Turn AI off</span> for this shop (kill switch)
            </span>
          </label>
          <Button
            className="w-full"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const capRupees = cap.trim() === "" ? null : Number(cap);
                if (capRupees != null && (!Number.isFinite(capRupees) || capRupees < 0)) throw new Error("Enter a valid amount");
                await api(`/admin/ai-budget/${biz.businessId}`, { method: "PUT", body: { monthlyCapRupees: capRupees, killSwitch: kill, alertPct: 80 } });
                toast.success("AI budget saved");
                await qc.invalidateQueries({ queryKey: ["admin", "ai-usage"] });
                onClose();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save budget
          </Button>
        </div>
      )}
    </ResponsiveModal>
  );
}

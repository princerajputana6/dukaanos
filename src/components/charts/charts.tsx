"use client";
/**
 * Single-series charts (one brand hue → no legend; the card title names the series).
 * Thin marks, rounded bar ends on the baseline, recessive grid, hover tooltips, and every
 * chart has a table fallback via `aria-label` + the lists shown alongside it.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatShortDate } from "@/lib/dates";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { cn } from "@/lib/utils";

interface Point {
  date: string;
  value: number;
}

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };

function ChartTooltip({ active, payload, label, valueLabel }: { active?: boolean; payload?: Array<{ value: number }>; label?: string; valueLabel: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-[12.5px] shadow-lift">
      <p className="text-muted-foreground">{label ? formatShortDate(label) : ""}</p>
      <p className="tabular font-semibold">
        {valueLabel}: {formatMoney(payload[0]!.value, { compact: true })}
      </p>
    </div>
  );
}

/** Money over time (area, 2px line). */
export function TrendChart({ data, valueLabel, height = 200, className, color = "var(--chart-1)" }: { data: Point[]; valueLabel: string; height?: number; className?: string; color?: string }) {
  const id = `g-${valueLabel.replace(/\W/g, "")}`;
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className={cn("w-full", className)} role="img" aria-label={`${valueLabel} by day, total ${formatMoney(total, { compact: true })}`}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
          <XAxis dataKey="date" tickFormatter={(d: string) => formatShortDate(d)} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickFormatter={(v: number) => formatMoneyShort(v)} tick={axisTick} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<ChartTooltip valueLabel={valueLabel} />} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${id})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Daily bars (e.g. expenses). */
export function DailyBars({ data, valueLabel, height = 180, color = "var(--chart-2)" }: { data: Point[]; valueLabel: string; height?: number; color?: string }) {
  return (
    <div role="img" aria-label={`${valueLabel} by day`}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="date" tickFormatter={(d: string) => formatShortDate(d)} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickFormatter={(v: number) => formatMoneyShort(v)} tick={axisTick} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<ChartTooltip valueLabel={valueLabel} />} cursor={{ fill: "var(--accent)" }} />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars as plain HTML (readable labels, no axis clutter). */
export function RankedBars({ items, formatValue }: { items: Array<{ label: string; value: number; sub?: string; href?: string }>; formatValue: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="truncate font-medium">{i.label}</span>
            <span className="tabular shrink-0 font-semibold">{formatValue(i.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </div>
          {i.sub && <p className="mt-0.5 text-[12px] text-muted-foreground">{i.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

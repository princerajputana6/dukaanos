"use client";
import { addDays, startOfMonth, todayIst, type IsoDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export const RANGE_PRESETS = [
  { id: "today", label: "Today", get: (t: IsoDate) => ({ from: t, to: t }) },
  { id: "yesterday", label: "Yesterday", get: (t: IsoDate) => ({ from: addDays(t, -1), to: addDays(t, -1) }) },
  { id: "7d", label: "7 days", get: (t: IsoDate) => ({ from: addDays(t, -6), to: t }) },
  { id: "month", label: "This month", get: (t: IsoDate) => ({ from: startOfMonth(t), to: t }) },
  { id: "30d", label: "30 days", get: (t: IsoDate) => ({ from: addDays(t, -29), to: t }) },
  {
    id: "lastmonth",
    label: "Last month",
    get: (t: IsoDate) => {
      const end = addDays(startOfMonth(t), -1);
      return { from: startOfMonth(end), to: end };
    },
  },
] as const;

export function presetRange(id: (typeof RANGE_PRESETS)[number]["id"]): DateRange {
  return RANGE_PRESETS.find((p) => p.id === id)!.get(todayIst());
}

/** Preset chips + custom from/to — horizontally scrollable on phones. */
export function DateRangePicker({ value, onChange, className }: { value: DateRange; onChange: (r: DateRange) => void; className?: string }) {
  const today = todayIst();
  const active = RANGE_PRESETS.find((p) => {
    const r = p.get(today);
    return r.from === value.from && r.to === value.to;
  })?.id;
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            onClick={() => onChange(p.get(today))}
            className={cn(
              "h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              active === p.id ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[13px]">
        <input
          type="date"
          aria-label="From date"
          value={value.from}
          max={value.to}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, to: value.to })}
          className="h-9 rounded-lg border bg-card px-2"
        />
        <span className="text-muted-foreground">to</span>
        <input
          type="date"
          aria-label="To date"
          value={value.to}
          min={value.from}
          max={today}
          onChange={(e) => e.target.value && onChange({ from: value.from, to: e.target.value })}
          className="h-9 rounded-lg border bg-card px-2"
        />
      </div>
    </div>
  );
}

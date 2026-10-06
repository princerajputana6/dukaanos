"use client";
import { MinusIcon, PlusIcon } from "lucide-react";
import * as React from "react";
import { formatQty, toMilli } from "@/lib/qty";
import { cn } from "@/lib/utils";

/** Big +/- quantity control with direct typing (supports decimals like 0.5 kg). */
export function QtyStepper({
  value,
  onChange,
  min = 0,
  step = 1000,
  label,
  className,
  size = "default",
}: {
  value: number;
  onChange: (milli: number) => void;
  min?: number;
  step?: number;
  label: string;
  className?: string;
  size?: "sm" | "default";
}) {
  const [text, setText] = React.useState(formatQty(value).replace(/,/g, ""));
  const [prev, setPrev] = React.useState(value);
  if (value !== prev) {
    setPrev(value);
    if (toMilli(text || "0") !== value) setText(formatQty(value).replace(/,/g, ""));
  }
  const btn = cn("flex shrink-0 items-center justify-center rounded-lg text-foreground/80 hover:bg-accent disabled:opacity-40", size === "sm" ? "size-8" : "size-10");
  return (
    <div className={cn("inline-flex items-center rounded-xl border bg-card p-0.5", className)} role="group" aria-label={label}>
      <button type="button" className={btn} aria-label={`Decrease ${label}`} disabled={value - step < min} onClick={() => onChange(Math.max(min, value - step))}>
        <MinusIcon className="size-4" />
      </button>
      <input
        aria-label={label}
        inputMode="decimal"
        className={cn("tabular w-12 bg-transparent text-center font-semibold outline-none", size === "sm" ? "text-[14px]" : "text-[15px]")}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          setText(t);
          const m = toMilli(t || "0");
          if (m !== null) {
            setPrev(m);
            onChange(m);
          }
        }}
        onBlur={() => setText(formatQty(value).replace(/,/g, ""))}
      />
      <button type="button" className={btn} aria-label={`Increase ${label}`} onClick={() => onChange(value + step)}>
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}

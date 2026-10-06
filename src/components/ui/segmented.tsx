"use client";
import { cn } from "@/lib/utils";

interface Option<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

/** Large, thumb-friendly single-choice control (radio group semantics). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  columns,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly Option<T>[];
  label: string;
  className?: string;
  columns?: number;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-[13px] font-semibold transition-colors",
              active ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card text-foreground/80 hover:bg-accent",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

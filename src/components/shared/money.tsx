import { formatMoney } from "@/lib/money";
import { formatQty } from "@/lib/qty";
import { cn } from "@/lib/utils";

export function Money({ paise, compact, className, signed }: { paise: number; compact?: boolean; className?: string; signed?: boolean }) {
  const text = formatMoney(Math.abs(paise), { compact });
  return <span className={cn("tabular whitespace-nowrap", className)}>{signed ? (paise > 0 ? "+" : paise < 0 ? "−" : "") : paise < 0 ? "−" : ""}{text}</span>;
}

export function Qty({ milli, unit, className }: { milli: number; unit?: string; className?: string }) {
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>
      {formatQty(milli)}
      {unit ? <span className="text-muted-foreground"> {unit}</span> : null}
    </span>
  );
}

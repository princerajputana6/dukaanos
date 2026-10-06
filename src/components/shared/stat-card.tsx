import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger";
  href?: string;
}) {
  const toneCls = { default: "bg-primary-soft text-primary", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning-foreground", danger: "bg-destructive-soft text-destructive" }[tone];
  const body = (
    <div className={cn("h-full rounded-2xl border bg-card p-4 shadow-soft transition-colors", href && "hover:border-primary/30")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("flex size-8 items-center justify-center rounded-lg", toneCls)}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="tabular mt-1.5 text-[22px] leading-tight font-semibold tracking-tight sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

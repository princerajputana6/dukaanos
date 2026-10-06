import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="-ml-1 mb-1.5 inline-flex h-8 items-center gap-0.5 rounded-lg pr-2 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <h1 className="truncate text-[22px] leading-tight font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-[14px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

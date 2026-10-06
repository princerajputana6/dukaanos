import { cn } from "@/lib/utils";

/** DukaanOS mark: a shop awning over a voice wave — "talk to your shop". */
export function LogoMark({ className, title = "DukaanOS" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} role="img" aria-label={title}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M7.5 10.5h17v2.6a2.83 2.83 0 0 1-5.67 0 2.83 2.83 0 0 1-5.66 0 2.83 2.83 0 0 1-5.67 0z"
        className="fill-primary-foreground"
      />
      <rect x="10.6" y="17.6" width="2.2" height="6" rx="1.1" className="fill-primary-foreground" />
      <rect x="14.9" y="16" width="2.2" height="9.2" rx="1.1" className="fill-primary-foreground" />
      <rect x="19.2" y="17.6" width="2.2" height="6" rx="1.1" className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && (
        <span className="text-[17px] font-bold tracking-tight">
          Dukaan<span className="text-primary">OS</span>
        </span>
      )}
    </span>
  );
}

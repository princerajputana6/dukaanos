import { cn } from "@/lib/utils";

/** A phone bezel wrapping a live mockup of an app screen (not an image). */
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative rounded-[2.6rem] bg-[oklch(0.18_0.01_255)] p-[9px] shadow-[0_30px_80px_-20px_oklch(0.2_0.05_200/0.45)] ring-1 ring-black/10", className)}>
      <div className="absolute top-[18px] left-1/2 z-20 h-[22px] w-[30%] -translate-x-1/2 rounded-full bg-[oklch(0.18_0.01_255)]" aria-hidden="true" />
      <div className="relative aspect-[390/844] w-full overflow-hidden rounded-[2rem] bg-background">
        <div className="absolute inset-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

/** A minimal browser window wrapping a live mockup. */
export function BrowserFrame({ children, className, url = "app.suvakta.com" }: { children: React.ReactNode; className?: string; url?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-card shadow-[0_30px_80px_-24px_oklch(0.2_0.05_200/0.4)]", className)}>
      <div className="flex h-9 items-center gap-1.5 border-b bg-muted/60 px-3" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-[oklch(0.7_0.17_25)]" />
        <span className="size-2.5 rounded-full bg-[oklch(0.82_0.15_85)]" />
        <span className="size-2.5 rounded-full bg-[oklch(0.72_0.15_150)]" />
        <span className="mx-auto hidden h-5 w-1/2 items-center justify-center rounded-md bg-background px-2 text-[11px] text-muted-foreground sm:flex">{url}</span>
      </div>
      <div className="aspect-[1440/900] w-full overflow-hidden bg-background">{children}</div>
    </div>
  );
}

/** Animated voice bars — decorative. */
export function VoiceWave({ className, bars = 5 }: { className?: string; bars?: number }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-[3px]", className)} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="voice-bar w-[3px] rounded-full bg-current" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

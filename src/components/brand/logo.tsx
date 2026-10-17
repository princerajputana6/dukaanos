import { cn } from "@/lib/utils";

/**
 * Suvakta brand lockup (shop awning + voice equalizer inside a speech bubble, with the
 * "Suvakta" wordmark). Two raster variants are shipped and swapped by the system colour
 * scheme: the navy wordmark reads on light surfaces, a white wordmark on dark ones.
 * `compact` shows only the mark (narrow headers, the auth panel, app bar).
 */

/** Just the mark (no wordmark) — a near-square glyph. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-block aspect-square h-8", className)} role="img" aria-label="Suvakta">
      <img src="/brand/suvakta-mark.png" alt="" width={129} height={128} className="h-full w-auto dark:hidden" />
      <img src="/brand/suvakta-mark-dark.png" alt="" width={129} height={128} className="hidden h-full w-auto dark:block" />
    </span>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  const base = compact ? "/brand/suvakta-mark" : "/brand/suvakta-logo";
  const w = compact ? 129 : 384;
  // Full lockup is 3:1 → a 28px-tall logo is ~84px wide; the mark is ~square at 32px.
  return (
    <span className={cn("inline-flex items-center", compact ? "h-8" : "h-7", className)} role="img" aria-label="Suvakta">
      <img src={`${base}.png`} alt="Suvakta" width={w} height={128} className="h-full w-auto select-none dark:hidden" />
      <img src={`${base}-dark.png`} alt="Suvakta" width={w} height={128} className="hidden h-full w-auto select-none dark:block" />
    </span>
  );
}

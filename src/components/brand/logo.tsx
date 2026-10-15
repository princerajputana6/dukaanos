import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Suvakta (सुवक्ता, "the eloquent speaker") mark.
 * Five rounded bars rise like a voice equalizer and a growth chart at once — voice-first,
 * business-forward — inside a soft squircle. The tallest bar carries a "voice pulse" dot.
 */
export function LogoMark({ className, title = "Suvakta" }: { className?: string; title?: string }) {
  const gid = React.useId();
  return (
    <svg viewBox="0 0 40 40" className={cn("size-8", className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`${gid}-bg`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="oklch(0.56 0.11 172)" />
          <stop offset="1" stopColor="oklch(0.44 0.1 196)" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gid}-bg)`} />
      {/* Equalizer / growth bars, left→right rising. */}
      <g className="fill-white">
        <rect x="8.5" y="22.5" width="4.2" height="9" rx="2.1" />
        <rect x="15" y="18" width="4.2" height="13.5" rx="2.1" fillOpacity="0.9" />
        <rect x="21.5" y="13" width="4.2" height="18.5" rx="2.1" fillOpacity="0.8" />
        <rect x="28" y="20" width="4.2" height="11.5" rx="2.1" fillOpacity="0.72" />
      </g>
      {/* Voice pulse on the peak bar. */}
      <circle cx="23.6" cy="9.4" r="2.4" className="fill-white" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && (
        <span className="text-[17px] font-bold tracking-tight">
          Suvakta<span className="text-primary">.</span>
        </span>
      )}
    </span>
  );
}

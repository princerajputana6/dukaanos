import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Suvakta (सुवक्ता, "the eloquent speaker") mark.
 *
 * A speech bubble — the conversation at the heart of the product — with three rising bars inside
 * that read as both a voice equalizer and a growth chart, and a voice-pulse dot above the peak.
 * The whole idea in one glyph: *talk to your shop, and it grows.*
 */
export function LogoMark({ className, title = "Suvakta" }: { className?: string; title?: string }) {
  const g = React.useId();
  return (
    <svg viewBox="0 0 40 40" className={cn("size-8", className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`${g}-bg`} x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1aa184" />
          <stop offset="1" stopColor="#0a6ea0" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${g}-bg)`} />
      {/* Speech bubble with a tail at the bottom-left. */}
      <path
        d="M11 8.5h18a4.5 4.5 0 0 1 4.5 4.5v8a4.5 4.5 0 0 1-4.5 4.5H19l-5.8 4.4.7-4.4H11a4.5 4.5 0 0 1-4.5-4.5v-8A4.5 4.5 0 0 1 11 8.5Z"
        className="fill-white"
      />
      {/* Equalizer / growth bars, rising left→right. */}
      <g fill="#0f8f74">
        <rect x="12.5" y="18.4" width="3" height="5.6" rx="1.5" />
        <rect x="18.5" y="15" width="3" height="9" rx="1.5" />
        <rect x="24.5" y="11.8" width="3" height="12.2" rx="1.5" />
      </g>
      {/* Voice pulse above the peak bar. */}
      <circle cx="26" cy="9.2" r="2" fill="#0f8f74" />
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

"use client";
import { MicIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useVoiceStore } from "./voice-store";
import { VoiceSheet } from "./voice-sheet";

/** Floating AI voice button — always one tap away, above the mobile bottom nav. */
export function VoiceFab() {
  const openSheet = useVoiceStore((s) => s.openSheet);
  const pathname = usePathname();
  // The AI page has its own mic; the POS screen has a sticky checkout bar.
  const hidden = pathname === "/ai" || pathname === "/sales/new" || pathname === "/purchases/new";
  return (
    <>
      {!hidden && (
        <button
          type="button"
          onClick={() => openSheet({ listen: true })}
          aria-label="Talk to Suvakta (voice assistant)"
          className="fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 flex size-15 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift transition-transform hover:scale-105 active:scale-95 md:right-8 md:bottom-8 md:size-16"
        >
          <MicIcon className="size-7" aria-hidden="true" />
        </button>
      )}
      <VoiceSheet />
    </>
  );
}

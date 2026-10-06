"use client";
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Tailwind `md` breakpoint (768px). */
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");

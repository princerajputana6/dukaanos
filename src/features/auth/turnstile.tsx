"use client";
import * as React from "react";
import { apiGet } from "@/lib/api";

/**
 * Cloudflare Turnstile (invisible/managed CAPTCHA) for the pre-auth forms. When no site key is
 * configured (local/dev), `useTurnstileSiteKey` returns null and the forms submit normally.
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile failed to load."));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** undefined = still loading config, null = not configured, string = the site key. */
export function useTurnstileSiteKey(): string | null | undefined {
  const [key, setKey] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    let active = true;
    apiGet<{ turnstileSiteKey: string | null }>("/public/config")
      .then((c) => active && setKey(c.turnstileSiteKey))
      .catch(() => active && setKey(null));
    return () => {
      active = false;
    };
  }, []);
  return key;
}

export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const idRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void loadScript()
      .then(() => {
        if (cancelled || !ref.current) return;
        const tw = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
        if (!tw) return;
        idRef.current = tw.render(ref.current, {
          sitekey: siteKey,
          callback: (t: string) => onToken(t),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      const tw = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (tw && idRef.current) {
        try {
          tw.remove(idRef.current);
        } catch {
          /* already gone */
        }
      }
    };
  }, [siteKey, onToken]);
  return <div ref={ref} className="min-h-[65px]" />;
}

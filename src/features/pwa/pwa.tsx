"use client";
import { DownloadIcon, XIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "dukaan:install-dismissed";

/** Registers the service worker (production builds) — the app shell then works offline. */
export function ServiceWorkerRegistration() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const enabled = import.meta.env.PROD || new URLSearchParams(location.search).has("sw");
    if (!enabled) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.warn("SW registration failed", err));
  }, []);
  return null;
}

/** Tells the service worker to drop cached business data (logout / switch business). */
export async function clearOfflineData() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.active?.postMessage("clear-data");
  } catch {
    /* no SW */
  }
}

function subscribeInstall(cb: () => void) {
  window.addEventListener("beforeinstallprompt", cb);
  window.addEventListener("appinstalled", cb);
  return () => {
    window.removeEventListener("beforeinstallprompt", cb);
    window.removeEventListener("appinstalled", cb);
  };
}

let deferred: BeforeInstallPromptEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
  });
}

/** "Install DukaanOS" banner: native prompt on Android/desktop Chrome, instructions on iOS. */
export function InstallPrompt() {
  const canPrompt = React.useSyncExternalStore(subscribeInstall, () => deferred !== null, () => false);
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const ios = React.useSyncExternalStore(
    () => () => undefined,
    () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches,
    () => false,
  );
  if (dismissed || (!canPrompt && !ios)) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-soft">
      <img src="/icons/icon-192.png" alt="" className="size-10 rounded-xl" />
      <div className="min-w-0 flex-1 text-[13.5px]">
        <p className="font-semibold">Install DukaanOS</p>
        <p className="text-muted-foreground">{canPrompt ? "Open it like an app, even offline." : "Tap Share, then “Add to Home Screen”."}</p>
      </div>
      {canPrompt && (
        <Button
          size="sm"
          onClick={async () => {
            await deferred?.prompt();
            const r = await deferred?.userChoice;
            deferred = null;
            if (r?.outcome) dismiss();
          }}
        >
          <DownloadIcon /> Install
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={dismiss}>
        <XIcon />
      </Button>
    </div>
  );
}

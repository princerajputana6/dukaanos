"use client";
import { AlertTriangleIcon } from "lucide-react";
import { addDays, formatDate, todayIst } from "@/lib/dates";
import { useSession } from "./session-context";

/** Read-only / expiring-soon notice shown at the top of every shop page. */
export function LicenseBanner() {
  const me = useSession();
  const a = me.membership.access;
  const soon = a.writable && a.validUntil && a.validUntil <= addDays(todayIst(), 7);
  if (a.writable && !soon) return null;
  return (
    <div role="status" className={a.writable ? "bg-warning-soft text-warning-foreground" : "bg-destructive-soft text-destructive"}>
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-[13px] font-medium md:px-6">
        <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
        <span>
          {a.writable
            ? `Your ${a.licenseStatus === "TRIAL" ? "free trial" : "licence"} ends on ${formatDate(a.validUntil!)}. Contact DukaanOS to renew.`
            : `${a.reason} Your data is safe and can still be viewed and exported.`}
        </span>
      </div>
    </div>
  );
}

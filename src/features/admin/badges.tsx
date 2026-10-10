import { Badge } from "@/components/ui/badge";
import { LICENSE_PLANS, LICENSE_STATUS_LABELS, type LicensePlan, type LicenseStatus } from "@/lib/domain";
import { formatDate, todayIst, addDays } from "@/lib/dates";

const LICENSE_VARIANT: Record<LicenseStatus, "success" | "info" | "danger" | "warning" | "neutral"> = {
  ACTIVE: "success",
  TRIAL: "info",
  SUSPENDED: "danger",
  EXPIRED: "warning",
  CANCELLED: "neutral",
};

export function LicenseBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="neutral">No licence</Badge>;
  const s = status as LicenseStatus;
  return <Badge variant={LICENSE_VARIANT[s] ?? "neutral"}>{LICENSE_STATUS_LABELS[s] ?? status}</Badge>;
}

export function PlanBadge({ plan }: { plan: string | null | undefined }) {
  if (!plan) return null;
  return <Badge variant="outline">{LICENSE_PLANS[plan as LicensePlan]?.label ?? plan}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const v = status === "ACTIVE" ? "success" : status === "SUSPENDED" ? "danger" : "neutral";
  return <Badge variant={v}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

/** "till 12 Oct 2026" with a warning tone when within 7 days. */
export function ValidUntil({ date }: { date: string | null | undefined }) {
  if (!date) return <span className="text-muted-foreground">No end date</span>;
  const today = todayIst();
  const soon = date <= addDays(today, 7);
  const past = date < today;
  return <span className={past ? "font-semibold text-destructive" : soon ? "font-semibold text-warning-foreground" : ""}>{past ? "Ended " : "Till "}{formatDate(date)}</span>;
}

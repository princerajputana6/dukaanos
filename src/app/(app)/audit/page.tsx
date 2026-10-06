import type { Metadata } from "next";
import { AuditView } from "@/features/audit/audit-view";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return <AuditView />;
}

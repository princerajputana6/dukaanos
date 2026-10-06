import type { Metadata } from "next";
import { SecuritySettings } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Security" };

export default function Page() {
  return <SecuritySettings />;
}

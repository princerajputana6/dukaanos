import type { Metadata } from "next";
import { BusinessSettings } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Business settings" };

export default function Page() {
  return <BusinessSettings />;
}

import type { Metadata } from "next";
import { GstSettings } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "GST settings" };

export default function Page() {
  return <GstSettings />;
}

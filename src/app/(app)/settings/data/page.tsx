import type { Metadata } from "next";
import { DataSettings } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Data export" };

export default function Page() {
  return <DataSettings />;
}

import type { Metadata } from "next";
import { SettingsIndex } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <SettingsIndex />;
}

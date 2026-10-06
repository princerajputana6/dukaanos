import type { Metadata } from "next";
import { VoiceSettings } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Voice & AI" };

export default function Page() {
  return <VoiceSettings />;
}

import type { Metadata } from "next";
import { AiUsageSettings } from "@/features/settings/ai-usage";
export const metadata: Metadata = { title: "AI usage" };
export default function Page() {
  return <AiUsageSettings />;
}

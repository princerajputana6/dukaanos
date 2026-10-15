import type { Metadata } from "next";
import { InsightsView } from "@/features/insights/insights";
export const metadata: Metadata = { title: "Insights" };
export default function Page() {
  return <InsightsView />;
}

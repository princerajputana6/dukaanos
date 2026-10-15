import type { Metadata } from "next";
import { StockCountView } from "@/features/inventory/stock-count";

export const metadata: Metadata = { title: "Stock count" };

export default function Page() {
  return <StockCountView />;
}

import type { Metadata } from "next";
import { StockCountDetail } from "@/features/inventory/stock-count-detail";

export const metadata: Metadata = { title: "Stock count" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StockCountDetail id={id} />;
}

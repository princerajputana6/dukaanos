import type { Metadata } from "next";
import { SaleDetailView } from "@/features/sales/sale-detail";

export const metadata: Metadata = { title: "Bill" };

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SaleDetailView id={id} />;
}

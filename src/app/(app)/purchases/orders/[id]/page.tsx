import type { Metadata } from "next";
import { PurchaseOrderDetailView } from "@/features/purchases/purchase-orders";
export const metadata: Metadata = { title: "Purchase order" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseOrderDetailView id={id} />;
}

import type { Metadata } from "next";
import { PurchaseDetailView } from "@/features/purchases/purchases-views";

export const metadata: Metadata = { title: "Purchase" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseDetailView id={id} />;
}

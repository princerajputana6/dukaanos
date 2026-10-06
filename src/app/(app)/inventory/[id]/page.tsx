import type { Metadata } from "next";
import { ProductDetailView } from "@/features/inventory/product-detail";

export const metadata: Metadata = { title: "Product" };

export default async function InventoryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetailView id={id} />;
}

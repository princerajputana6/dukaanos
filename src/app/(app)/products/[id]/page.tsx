import type { Metadata } from "next";
import { EditProduct } from "@/features/products/edit-product";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditProduct id={id} />;
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ProductForm } from "@/features/products/product-form";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const { name } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add product" back={{ href: "/products", label: "Products" }} />
      <ProductForm initialName={name?.slice(0, 120)} />
    </div>
  );
}

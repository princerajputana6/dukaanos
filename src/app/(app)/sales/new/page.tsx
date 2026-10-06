import type { Metadata } from "next";
import { NewSale } from "@/features/sales/new-sale";

export const metadata: Metadata = { title: "New sale" };

export default function NewSalePage() {
  return <NewSale />;
}

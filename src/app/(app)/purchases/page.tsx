import type { Metadata } from "next";
import { PurchasesList } from "@/features/purchases/purchases-views";

export const metadata: Metadata = { title: "Purchases" };

export default function Page() {
  return <PurchasesList />;
}

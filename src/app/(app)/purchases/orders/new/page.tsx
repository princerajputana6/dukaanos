import type { Metadata } from "next";
import { NewPurchaseOrderView } from "@/features/purchases/purchase-orders";
export const metadata: Metadata = { title: "New purchase order" };
export default function Page() {
  return <NewPurchaseOrderView />;
}

import type { Metadata } from "next";
import { PurchaseOrdersView } from "@/features/purchases/purchase-orders";
export const metadata: Metadata = { title: "Purchase orders" };
export default function Page() {
  return <PurchaseOrdersView />;
}

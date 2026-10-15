import type { Metadata } from "next";
import { TransferStockView } from "@/features/inventory/transfer-stock";

export const metadata: Metadata = { title: "Transfer stock" };

export default function Page() {
  return <TransferStockView />;
}

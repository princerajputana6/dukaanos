import type { Metadata } from "next";
import { CashbookView } from "@/features/cashbook/cashbook";
export const metadata: Metadata = { title: "Cashbook" };
export default function Page() {
  return <CashbookView />;
}

import type { Metadata } from "next";
import { NewPurchase } from "@/features/purchases/new-purchase";

export const metadata: Metadata = { title: "New purchase" };

export default function Page() {
  return <NewPurchase />;
}

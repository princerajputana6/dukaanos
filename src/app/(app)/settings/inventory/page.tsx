import type { Metadata } from "next";
import { InventorySettings } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Inventory settings" };

export default function Page() {
  return <InventorySettings />;
}

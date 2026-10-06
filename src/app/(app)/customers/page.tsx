import type { Metadata } from "next";
import { PartyListView } from "@/features/parties/party-views";

export const metadata: Metadata = { title: "Khata" };

export default function Page() {
  return <PartyListView kind="customer" />;
}

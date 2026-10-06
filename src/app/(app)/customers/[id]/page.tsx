import type { Metadata } from "next";
import { PartyDetailView } from "@/features/parties/party-views";

export const metadata: Metadata = { title: "Khata" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartyDetailView kind="customer" id={id} />;
}

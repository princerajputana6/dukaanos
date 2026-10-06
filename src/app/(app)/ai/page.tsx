import type { Metadata } from "next";
import { AssistantChat } from "@/features/ai/assistant-chat";

export const metadata: Metadata = { title: "AI Assistant" };

export default function Page() {
  return <AssistantChat />;
}

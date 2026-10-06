import type { Metadata } from "next";
import { NotificationSettings } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Notification settings" };

export default function Page() {
  return <NotificationSettings />;
}

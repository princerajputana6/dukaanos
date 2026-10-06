import type { Metadata } from "next";
import { UsersSettings } from "@/features/settings/team";

export const metadata: Metadata = { title: "Users" };

export default function Page() {
  return <UsersSettings />;
}

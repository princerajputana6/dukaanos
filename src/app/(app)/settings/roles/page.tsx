import type { Metadata } from "next";
import { RolesSettings } from "@/features/settings/team";

export const metadata: Metadata = { title: "Roles" };

export default function Page() {
  return <RolesSettings />;
}

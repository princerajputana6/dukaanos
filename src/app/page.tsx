import { redirect } from "next/navigation";
import { getPageSession } from "@/server/auth/page-session";

export default async function Home() {
  const session = await getPageSession();
  if (!session) redirect("/login");
  if (!session.membership) redirect("/login");
  redirect(session.membership.onboardedAt ? "/dashboard" : "/onboarding");
}

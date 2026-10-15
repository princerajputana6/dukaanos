import { redirect } from "next/navigation";
import { getPageSession } from "@/server/auth/page-session";

export default async function Home() {
  const session = await getPageSession();
  if (session?.membership) redirect(session.membership.onboardedAt ? "/dashboard" : "/onboarding");
  return <p>temp landing</p>;
}

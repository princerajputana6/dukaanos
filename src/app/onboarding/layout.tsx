import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { SessionProvider, type MeData } from "@/features/session/session-context";
import { getPageSession } from "@/server/auth/page-session";
import { getDb } from "@/server/db/client";
import { listUserBusinesses } from "@/server/services/auth";
import { getBusinessBundle } from "@/server/services/business";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession();
  if (!session?.membership) redirect("/login");
  if (session.membership.onboardedAt) redirect("/dashboard");
  const db = getDb(env.DB);
  const [bundle, businesses] = await Promise.all([getBusinessBundle(db, env, session.membership.businessId), listUserBusinesses(db, session.user.id)]);
  const initial: MeData = { user: session.user, membership: session.membership, businesses, ...bundle };
  return <SessionProvider initial={initial}>{children}</SessionProvider>;
}

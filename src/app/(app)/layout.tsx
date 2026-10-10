import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider, type MeData } from "@/features/session/session-context";
import { getPageSession } from "@/server/auth/page-session";
import { getDb } from "@/server/db/client";
import { listUserBusinesses } from "@/server/services/auth";
import { getBusinessBundle } from "@/server/services/business";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession();
  if (!session) redirect("/login");
  if (!session.membership) redirect(session.user.platformRole === "SUPER_ADMIN" ? "/admin" : "/login");
  if (!session.membership.onboardedAt) redirect("/onboarding");

  const db = getDb(env.DB);
  const [bundle, businesses] = await Promise.all([
    getBusinessBundle(db, env, session.membership.businessId),
    listUserBusinesses(db, session.user.id),
  ]);
  const initial: MeData = { user: session.user, membership: session.membership, businesses, ...bundle };

  return (
    <SessionProvider initial={initial}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}

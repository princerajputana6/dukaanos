import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LandingPage } from "@/features/marketing/landing";
import { BRAND } from "@/lib/brand";
import { getPageSession } from "@/server/auth/page-session";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name} — ${BRAND.tagline}` },
  description: BRAND.description,
  openGraph: { title: `${BRAND.name} — Bolo, aur hisaab ho gaya.`, description: BRAND.description, images: ["/marketing/og.jpg"], type: "website" },
};

/** Logged-in users go straight to their workspace; everyone else sees the website. */
export default async function Home() {
  const session = await getPageSession();
  if (session?.membership) redirect(session.membership.onboardedAt ? "/dashboard" : "/onboarding");
  if (session?.user.platformRole === "SUPER_ADMIN") redirect("/admin");
  return <LandingPage />;
}

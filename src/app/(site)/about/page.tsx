import { AboutContent } from "@/features/marketing/about-content";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "About", description: `Why we built ${BRAND.name} — and what the name means.` };

export default function Page() {
  return <AboutContent />;
}

import { ContactContent } from "@/features/marketing/contact-content";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Contact us", description: `Talk to the ${BRAND.name} team.` };

export default function Page() {
  return <ContactContent />;
}

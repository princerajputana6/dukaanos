import type { Metadata } from "next";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Set up your shop" };

export default function Page() {
  return <OnboardingWizard />;
}

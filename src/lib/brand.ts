/**
 * Brand constants — the single place to change the product name, contact details and
 * legal identity. Everything user-facing (site, app, legal pages, emails) reads from here.
 */
export const BRAND = {
  name: "Suvakta",
  /** सुवक्ता — "one who speaks well". */
  nameHindi: "सुवक्ता",
  tagline: "Run your shop by simply talking to it.",
  description: "Suvakta is the voice-first business app for Indian shops: speak in Hindi, English or Hinglish to record sales, stock, khata, purchases and expenses — with GST-ready reports.",
  /** Legal entity that operates the service, shown in the legal pages. Update when incorporated. */
  legalName: "Suvakta",
  /**
   * Public contact email. Left empty until the domain (suvakta.com / suvakta.ai) is live, so we
   * never publish an address that can't receive mail; pages fall back to the contact form.
   */
  supportEmail: "" as string,
  grievanceOfficer: { name: "Grievance Officer, Suvakta", email: "" as string },
  jurisdiction: "India",
  lastUpdated: "15 October 2026",
} as const;

export const LEGAL_LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/acceptable-use", label: "Acceptable Use Policy" },
  { href: "/security", label: "Data Security" },
  { href: "/grievance", label: "Grievance Redressal" },
] as const;

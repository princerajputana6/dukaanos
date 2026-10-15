import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { BRAND, LEGAL_LINKS } from "@/lib/brand";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#features", label: "Features" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#trust", label: "Security & trust" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About Suvakta" },
      { href: "/contact", label: "Contact us" },
      { href: "/#quote", label: "Request a quote" },
      { href: "/login", label: "Log in" },
    ],
  },
  { title: "Legal", links: LEGAL_LINKS },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs space-y-3">
          <Logo />
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            {BRAND.nameHindi} — “one who speaks well”. The voice-first business app for Indian shops.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">{c.title}</h2>
            <ul className="space-y-2">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[14px] hover:text-primary">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} {BRAND.legalName}. All rights reserved.
          </p>
          <p>Made in India, for the shops that run India.</p>
        </div>
      </div>
    </footer>
  );
}

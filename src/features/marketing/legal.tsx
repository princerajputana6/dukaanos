import Link from "next/link";
import { BRAND, LEGAL_LINKS } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Shared layout for policy pages: title, last-updated date, side navigation and readable prose. */
export function LegalPage({ title, intro, children, path }: { title: string; intro?: string; children: React.ReactNode; path: string }) {
  return (
    <div className="px-4 py-12 sm:px-6 md:py-16">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Legal" className="hidden lg:block">
          <ul className="sticky top-24 space-y-1">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={l.href === path ? "page" : undefined}
                  className={cn("block rounded-lg px-3 py-2 text-[14px]", l.href === path ? "bg-primary-soft font-semibold text-primary-soft-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <article className="max-w-3xl">
          <h1 className="text-[34px] leading-tight font-bold tracking-tight md:text-[42px]">{title}</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">Last updated: {BRAND.lastUpdated}</p>
          {intro && <p className="mt-6 text-[17px] leading-relaxed text-muted-foreground">{intro}</p>}
          <div className="prose-legal mt-8">{children}</div>
        </article>
      </div>
    </div>
  );
}

/** How to reach us — email once the domain is live, otherwise the contact form. */
export function ContactLine({ email = BRAND.supportEmail }: { email?: string }) {
  return email ? (
    <>
      by email at <a href={`mailto:${email}`}>{email}</a> or through our <Link href="/contact">contact form</Link>
    </>
  ) : (
    <>
      through our <Link href="/contact">contact form</Link>
    </>
  );
}

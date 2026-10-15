import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "About", description: `Why we built ${BRAND.name} — and what the name means.` };

const VALUES = [
  { title: "Speak, don’t type", body: "The fastest interface for a busy counter is the one every shopkeeper already uses: their voice." },
  { title: "You stay in control", body: "AI prepares, you decide. Nothing is saved without your confirmation, and nothing is ever silently deleted." },
  { title: "Correct to the paisa", body: "A business app must be right every time. We treat every rupee, every unit of stock and every entry with that seriousness." },
  { title: "Made for Bharat", body: "Hinglish, udhaar, crates and khata are not edge cases for us — they are how India does business." },
];

export default function Page() {
  return (
    <div className="px-4 py-14 sm:px-6 md:py-20">
      <div className="mx-auto max-w-3xl">
        <LogoMark className="size-14" />
        <p className="mt-8 text-[13px] font-semibold tracking-[0.14em] text-primary uppercase">About us</p>
        <h1 className="mt-3 text-[36px] leading-tight font-bold tracking-tight md:text-[48px]">
          {BRAND.nameHindi} <span className="text-muted-foreground">·</span> {BRAND.name}
        </h1>
        <p className="mt-3 text-[18px] text-muted-foreground">“One who speaks well.”</p>
        <div className="mt-10 space-y-5 text-[17px] leading-relaxed">
          <p>
            Crores of Indian shops still run on a notebook, memory and trust. Software was supposed to help, but most business apps expect shopkeepers to become data-entry operators —
            in English, in the middle of a rush.
          </p>
          <p>
            {BRAND.name} flips that. You speak the way you already do — <em>“aaj 20 Coke biki”, “Ramesh ne 500 diye”</em> — and {BRAND.name} turns it into accurate sales, stock, khata
            and GST-ready reports. The name says what we believe: the best business tool is one that listens well and speaks your language.
          </p>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2">
          {VALUES.map((v) => (
            <div key={v.title} className="rounded-3xl border bg-card p-6">
              <h2 className="text-[17px] font-semibold">{v.title}</h2>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{v.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/#quote">
              Request a quote <ArrowRightIcon />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/contact">Contact us</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";
import { MessageCircleIcon, ShieldQuestionIcon, StoreIcon } from "lucide-react";
import Link from "next/link";
import { QuoteForm } from "@/features/marketing/quote-form";
import { BRAND } from "@/lib/brand";

const TOPICS = [
  { icon: StoreIcon, title: "New to Suvakta?", body: "Tell us about your shop and we’ll call you with a demo and a quote." },
  { icon: MessageCircleIcon, title: "Already a customer?", body: "Log in and use the in-app assistant, or write to us below with your registered mobile number." },
  { icon: ShieldQuestionIcon, title: "Complaint or privacy request?", body: "Mention it in your message — see Grievance Redressal for timelines." },
];

export function ContactContent() {
  return (
    <div className="px-4 py-14 sm:px-6 md:py-20">
      <div className="mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-[13px] font-semibold tracking-[0.14em] text-primary uppercase">Contact</p>
          <h1 className="mt-3 text-[36px] leading-tight font-bold tracking-tight md:text-[46px]">We’d love to hear from you</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">Send us a message and our team will get back to you within one working day.</p>
          {BRAND.supportEmail && (
            <p className="mt-4 text-[16px]">
              Email:{" "}
              <a className="font-semibold text-primary hover:underline" href={`mailto:${BRAND.supportEmail}`}>
                {BRAND.supportEmail}
              </a>
            </p>
          )}
          <ul className="mt-8 space-y-4">
            {TOPICS.map((t) => (
              <li key={t.title} className="flex gap-4 rounded-2xl border bg-card p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <t.icon className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold">{t.title}</span>
                  <span className="text-[14.5px] text-muted-foreground">{t.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[14px] text-muted-foreground">
            See also:{" "}
            <Link href="/grievance" className="font-medium text-primary hover:underline">
              Grievance Redressal
            </Link>{" "}
            ·{" "}
            <Link href="/privacy" className="font-medium text-primary hover:underline">
              Privacy Policy
            </Link>
          </p>
        </div>
        <QuoteForm source="contact" />
      </div>
    </div>
  );
}

import Link from "next/link";
import { ContactLine, LegalPage } from "@/features/marketing/legal";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Terms of Service", description: `The terms that govern your use of ${BRAND.name}.` };

export default function Page() {
  const n = BRAND.name;
  return (
    <LegalPage path="/terms" title="Terms of Service" intro={`These Terms govern your access to and use of ${n} — our website, web app and related services (the “Service”). By creating an account or using the Service, you agree to them.`}>
      <h2>1. Who we are</h2>
      <p>
        The Service is operated by {BRAND.legalName} (“{n}”, “we”, “us”). In these Terms, “you” means the person or business using the Service. If you use {n} on behalf of a business,
        you confirm you are authorised to accept these Terms for it.
      </p>

      <h2>2. The Service</h2>
      <p>
        {n} is a business management application for shops and small businesses. It lets you record sales, purchases, stock, customer credit (khata), payments and expenses — by voice
        or by hand — and view reports, including GST summaries.
      </p>
      <ul>
        <li>
          <strong>Voice and AI features.</strong> Spoken or typed instructions are interpreted automatically. The interpretation is shown to you as a proposal and{" "}
          <strong>nothing is recorded until you confirm it</strong>. You are responsible for reviewing each proposal before confirming.
        </li>
        <li>
          <strong>Reports are tools, not advice.</strong> Reports, GST summaries and profit figures are calculated from the data you enter. They are not legal, tax or accounting advice;
          please verify filings with a qualified professional.
        </li>
      </ul>

      <h2>3. Accounts and security</h2>
      <ul>
        <li>You must provide accurate information and be at least 18 years old.</li>
        <li>You are responsible for keeping your password confidential and for all activity under your account and the staff accounts you create.</li>
        <li>As an owner, you decide which staff members get access and what they can do. Remove access promptly when someone leaves.</li>
        <li>Tell us immediately if you suspect unauthorised access to your account.</li>
      </ul>

      <h2>4. Plans, licences and payment</h2>
      <p>
        Access is provided under a licence plan for your account (for example a trial or a paid plan), which may limit the number of shops, branches or users. Plan details and prices
        are shared in your quote or order. Fees are payable as agreed and are exclusive of applicable taxes unless stated otherwise.
      </p>
      <p>
        If a licence expires or is suspended, your shops become <strong>read-only</strong>: you can still log in, view and export your data, but cannot record new entries until the
        licence is renewed. We do not delete your data because a licence lapsed, except as described in section 8.
      </p>

      <h2>5. Your data</h2>
      <p>
        You own the business data you enter (“Your Data”). You grant us a limited licence to host, process, back up and display Your Data solely to provide, secure and improve the
        Service and as described in our <Link href="/privacy">Privacy Policy</Link>. You are responsible for having the right to enter information about your customers, suppliers and
        staff, and for its accuracy.
      </p>

      <h2>6. Acceptable use</h2>
      <p>
        You agree to use the Service lawfully and in line with our <Link href="/acceptable-use">Acceptable Use Policy</Link>. We may suspend access that puts the Service, other users or
        the law at risk.
      </p>

      <h2>7. Availability and changes</h2>
      <p>
        We work to keep {n} available and reliable, including offline recording that syncs when you reconnect, but the Service is provided on an “as is” and “as available” basis. We
        may improve, change or discontinue features; we will give reasonable notice of material changes that reduce core functionality.
      </p>

      <h2>8. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate access for material breach of these Terms, non-payment or legal requirements. After termination we
        will, on request made within 30 days, provide an export of Your Data; after that we may delete it in line with our retention practices, except where the law requires us to
        keep it.
      </p>

      <h2>9. Intellectual property</h2>
      <p>
        The Service, including its software, design, the {n} name and logo, is owned by us and protected by law. These Terms do not give you any right to use our brand without
        permission.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, we are not liable for indirect, incidental or consequential losses, including lost profits or data entered incorrectly. Our total
        liability for any claim relating to the Service is limited to the fees you paid us in the 12 months before the claim arose.
      </p>

      <h2>11. Indemnity</h2>
      <p>You agree to indemnify us against claims arising from Your Data or your breach of these Terms or applicable law.</p>

      <h2>12. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of {BRAND.jurisdiction}. We will first try to resolve any dispute informally; see our <Link href="/grievance">Grievance Redressal</Link>{" "}
        process. Courts in India will have jurisdiction.
      </p>

      <h2>13. Changes to these Terms</h2>
      <p>We may update these Terms. We will post the new version here with a new date and, for material changes, notify account owners in the app or by message.</p>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms? Reach us <ContactLine />.
      </p>
    </LegalPage>
  );
}

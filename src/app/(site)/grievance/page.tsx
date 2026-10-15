import Link from "next/link";
import { LegalPage } from "@/features/marketing/legal";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Grievance Redressal", description: `How to raise a complaint or privacy request with ${BRAND.name}.` };

export default function Page() {
  const officer = BRAND.grievanceOfficer;
  return (
    <LegalPage
      path="/grievance"
      title="Grievance Redressal"
      intro="If something isn’t right — a problem with the Service, your account, content, or how your personal data is handled — we want to fix it quickly. This page explains how, in line with the Information Technology Act, 2000, its Rules, and the Digital Personal Data Protection Act, 2023."
    >
      <h2>Grievance Officer</h2>
      <p>
        <strong>{officer.name}</strong>
        <br />
        {officer.email ? (
          <>
            Email: <a href={`mailto:${officer.email}`}>{officer.email}</a>
            <br />
          </>
        ) : null}
        Online: <Link href="/contact">contact form</Link> (choose “Complaint / privacy request” in your message)
      </p>

      <h2>How to raise a grievance</h2>
      <ol>
        <li>Contact us with your name, registered mobile number, shop name (if any), and a clear description of the issue, including dates and screenshots if helpful.</li>
        <li>For a privacy request, tell us which right you want to exercise (access, correction, erasure, withdrawal of consent, or nomination).</li>
        <li>We may ask you to verify your identity before acting on account or data requests.</li>
      </ol>

      <h2>Timelines</h2>
      <ul>
        <li>We acknowledge every grievance within <strong>24 hours</strong>.</li>
        <li>We aim to resolve it within <strong>15 days</strong> of receipt, and will keep you updated if it needs longer.</li>
      </ul>

      <h2>If you are not satisfied</h2>
      <p>
        If your personal-data grievance is not resolved to your satisfaction, you may approach the Data Protection Board of India after exhausting this process, as provided under the
        Digital Personal Data Protection Act, 2023.
      </p>
    </LegalPage>
  );
}

import Link from "next/link";
import { ContactLine, LegalPage } from "@/features/marketing/legal";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Privacy Policy", description: `How ${BRAND.name} collects, uses and protects personal data.` };

export default function Page() {
  const n = BRAND.name;
  return (
    <LegalPage
      path="/privacy"
      title="Privacy Policy"
      intro={`${n} is built to be trusted with your shop’s data. This policy explains what personal data we collect, why, who we share it with, and the choices and rights you have — in line with India’s Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.`}
    >
      <h2>1. Who is responsible</h2>
      <p>
        For data about you as an account holder and for website enquiries, {BRAND.legalName} is the data fiduciary. For data that a shop records about its own customers, suppliers and
        staff inside {n}, the shop is responsible for that data and we process it on the shop’s behalf.
      </p>

      <h2>2. What we collect</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Examples</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Account details</td>
              <td>Name, mobile number, email (optional), password (stored only as a secure hash)</td>
              <td>To create and secure your account and let you log in</td>
            </tr>
            <tr>
              <td>Business details</td>
              <td>Shop name, type, city, state, GSTIN, branches, staff and roles</td>
              <td>To set up your shop, apply correct GST and permissions</td>
            </tr>
            <tr>
              <td>Business records</td>
              <td>Products, stock, sales, purchases, expenses, customer and supplier names, phone numbers and balances</td>
              <td>To provide the Service you use</td>
            </tr>
            <tr>
              <td>Voice and text commands</td>
              <td>Audio you record and the resulting text</td>
              <td>To understand and carry out your instruction (see section 4)</td>
            </tr>
            <tr>
              <td>Quote requests</td>
              <td>Name, business, mobile, email, city, message</td>
              <td>To contact you about your enquiry</td>
            </tr>
            <tr>
              <td>Technical data</td>
              <td>IP address, device/browser type, log entries, error reports</td>
              <td>Security, fraud and abuse prevention, troubleshooting</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>We do not sell personal data, and we do not use your business records for advertising.</p>

      <h2>3. Legal basis</h2>
      <p>
        We process personal data with your consent (for example when you sign up or submit a quote request) and for legitimate uses permitted by law, such as complying with legal
        obligations and keeping the Service secure. You can withdraw consent at any time; this will not affect processing already carried out, but we may no longer be able to provide
        the Service.
      </p>

      <h2>4. Voice processing</h2>
      <ul>
        <li>When you use the mic, audio is converted to text either by your browser’s built-in speech recognition (which may be provided by your browser vendor, such as Google for Chrome) or by our speech service hosted on Cloudflare.</li>
        <li>The text is interpreted to prepare a proposal. Only the text of the command and the result are kept, as part of your activity history; we do not keep the audio recording after it is transcribed.</li>
        <li>AI features only propose actions. Nothing is saved to your records until you confirm.</li>
      </ul>

      <h2>5. Who we share data with</h2>
      <ul>
        <li>
          <strong>Service providers</strong> who host and run the Service for us under contract — primarily Cloudflare, Inc. (hosting, database, file storage, AI and speech processing,
          email delivery). Data may be processed on their infrastructure inside or outside India, with appropriate safeguards.
        </li>
        <li>
          <strong>People you choose to share with</strong>, for example when you send a WhatsApp reminder to a customer (this opens WhatsApp on your device; we do not send the message).
        </li>
        <li>
          <strong>Authorities</strong>, when required by law or a valid legal process.
        </li>
        <li>
          <strong>Our support team</strong> may access your shop’s data only to help you or keep the Service secure; such access is recorded in the audit log.
        </li>
      </ul>

      <h2>6. How long we keep data</h2>
      <p>
        We keep account and business records for as long as your account is active and as needed to meet legal, tax and accounting obligations. After you close your account we delete
        or anonymise personal data within a reasonable period unless the law requires us to keep it. Quote requests that do not become customers are deleted within 24 months.
      </p>

      <h2>7. Security</h2>
      <p>
        We use encryption in transit (HTTPS), hashed passwords, strict separation between shops, role-based access and audit logs. Read more on our <Link href="/security">Data Security</Link>{" "}
        page. No system is perfectly secure; if a breach affects your personal data we will notify you and the authorities as required by law.
      </p>

      <h2>8. Your rights</h2>
      <p>Subject to applicable law, you can:</p>
      <ul>
        <li>access a summary of your personal data and how it is processed;</li>
        <li>correct, complete or update it (most of it you can edit yourself in Settings);</li>
        <li>ask us to erase it, unless we must keep it by law;</li>
        <li>withdraw consent;</li>
        <li>nominate someone to exercise these rights on your behalf in case of death or incapacity; and</li>
        <li>raise a grievance, and if unresolved, approach the Data Protection Board of India.</li>
      </ul>
      <p>
        To exercise a right, contact us <ContactLine />. Shop customers whose data was recorded by a shop should contact that shop first; we will help the shop respond.
      </p>

      <h2>9. Children</h2>
      <p>The Service is meant for businesses and is not directed at children under 18. We do not knowingly collect their personal data.</p>

      <h2>10. Cookies and local storage</h2>
      <p>
        We use only essential cookies and device storage needed to keep you signed in and make the app work offline. See our <Link href="/cookies">Cookie Policy</Link>.
      </p>

      <h2>11. Changes</h2>
      <p>We will post any changes to this policy here with a new date, and notify account owners of significant changes.</p>

      <h2>12. Grievances</h2>
      <p>
        For privacy concerns, contact our Grievance Officer as described on the <Link href="/grievance">Grievance Redressal</Link> page.
      </p>
    </LegalPage>
  );
}

import Link from "next/link";
import { ContactLine, LegalPage } from "@/features/marketing/legal";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Data Security", description: `How ${BRAND.name} keeps your business data safe and correct.` };

export default function Page() {
  return (
    <LegalPage path="/security" title="Data Security" intro="Your shop’s records are your livelihood. Here is how we protect them — from who can see them to making sure every rupee adds up.">
      <h2>AI never changes your data on its own</h2>
      <p>
        Voice and AI features only <strong>propose</strong> an action. The proposal is checked by our server rules (stock, permissions, amounts) and shown to you. Only when you tap
        Confirm does the server record it, through the same validated process used for manual entries. The AI has no direct access to your database.
      </p>

      <h2>Separation between businesses</h2>
      <ul>
        <li>Every record belongs to exactly one business, and every request is checked on the server against the signed-in user’s business and role.</li>
        <li>Branches and staff only see what their role allows. Staff can be prevented from seeing profit, costs or reports.</li>
      </ul>

      <h2>Accounts and access</h2>
      <ul>
        <li>Passwords are stored only as strong one-way hashes — nobody, including us, can read them.</li>
        <li>Sessions use secure, HttpOnly cookies and can be revoked; password resets sign you out everywhere.</li>
        <li>Login and sensitive endpoints are rate limited, and cross-site request forgery is blocked.</li>
        <li>Platform support access is restricted to authorised staff and every action is logged.</li>
      </ul>

      <h2>Correct, tamper-evident records</h2>
      <ul>
        <li>Money is stored as exact whole paise and quantities as exact units — no rounding drift.</li>
        <li>Each entry is saved atomically: a sale, its stock change and the customer balance are recorded together or not at all.</li>
        <li>The database itself refuses changes that would make stock negative by mistake.</li>
        <li>Duplicate submissions (double taps, retries, offline sync) are detected and recorded only once.</li>
        <li>Mistakes are corrected by reversal, not deletion, and every change is written to an audit log showing who, when and how.</li>
      </ul>

      <h2>Infrastructure</h2>
      <ul>
        <li>The Service runs on Cloudflare’s global network with encryption in transit (HTTPS/TLS).</li>
        <li>The database supports point-in-time recovery, so data can be restored to an earlier moment if something goes wrong.</li>
        <li>Offline entries are kept on your device only until they sync, and cached data is cleared when you log out.</li>
      </ul>

      <h2>What you can do</h2>
      <ul>
        <li>Use a strong, unique password and don’t share logins — give each staff member their own account.</li>
        <li>Remove staff access as soon as someone leaves.</li>
        <li>Keep your phone locked and your browser up to date.</li>
      </ul>

      <h2>Reporting a vulnerability</h2>
      <p>
        Found a security issue? Please report it <ContactLine />. See our <Link href="/acceptable-use">Acceptable Use Policy</Link> for responsible disclosure guidelines.
      </p>
    </LegalPage>
  );
}

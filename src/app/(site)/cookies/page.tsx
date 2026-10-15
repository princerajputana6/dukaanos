import { ContactLine, LegalPage } from "@/features/marketing/legal";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Cookie Policy", description: `The cookies and device storage ${BRAND.name} uses.` };

export default function Page() {
  const n = BRAND.name;
  return (
    <LegalPage
      path="/cookies"
      title="Cookie Policy"
      intro={`${n} uses as little as possible: only what is strictly necessary to sign you in and to make the app fast and usable offline. We do not use advertising or third-party tracking cookies.`}
    >
      <h2>1. Cookies we set</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Purpose</th>
              <th>Type</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>dk_session</td>
              <td>Keeps you securely signed in. HttpOnly, so scripts on the page cannot read it.</td>
              <td>Strictly necessary</td>
              <td>Up to 30 days, renewed while you use the app; removed on log out</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>Because this cookie is strictly necessary to provide the Service you request, it does not require separate consent, and there is no cookie banner.</p>

      <h2>2. Storage on your device</h2>
      <p>To work quickly and offline, the app also stores some information in your browser:</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Storage</th>
              <th>What it holds</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Service worker cache</td>
              <td>The app shell and recently viewed catalogue, parties and dashboard, so the app opens without internet.</td>
            </tr>
            <tr>
              <td>IndexedDB (offline queue)</td>
              <td>Sales, payments and expenses recorded while offline, until they sync to the server.</td>
            </tr>
            <tr>
              <td>Local storage</td>
              <td>Small preferences: unsaved bill drafts, whether you dismissed the install prompt, and voice-engine settings.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>This data stays on your device. Logging out clears your cached business data from the device.</p>

      <h2>3. Analytics and advertising</h2>
      <p>We do not use third-party analytics, advertising or social-media tracking cookies. If this changes, we will update this policy and ask for consent where required.</p>

      <h2>4. Managing cookies</h2>
      <p>
        You can delete cookies and site data in your browser settings at any time. If you block the session cookie you will not be able to sign in, and clearing site data while
        offline may remove entries that have not yet synced.
      </p>

      <h2>5. Contact</h2>
      <p>
        Questions? Reach us <ContactLine />.
      </p>
    </LegalPage>
  );
}

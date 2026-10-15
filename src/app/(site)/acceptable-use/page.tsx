import { ContactLine, LegalPage } from "@/features/marketing/legal";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Acceptable Use Policy", description: `What is and isn't allowed on ${BRAND.name}.` };

export default function Page() {
  return (
    <LegalPage path="/acceptable-use" title="Acceptable Use Policy" intro={`To keep ${BRAND.name} safe and reliable for every shop, you agree not to misuse the Service. This policy is part of our Terms of Service.`}>
      <h2>You may not</h2>
      <ul>
        <li>use the Service for any unlawful purpose, including recording sales of prohibited goods, tax evasion, fraud or money laundering;</li>
        <li>enter personal data about others without a lawful basis, or use customer phone numbers to send spam or harassing messages;</li>
        <li>try to access another business’s data, another user’s account, or parts of the Service you are not authorised to use;</li>
        <li>probe, scan or test the vulnerability of the Service, or bypass authentication, rate limits or other security measures (please report issues to us instead);</li>
        <li>overload the Service, including automated or bulk requests beyond normal use, or interfere with other users;</li>
        <li>copy, resell, reverse engineer or build a competing product from the Service, except as permitted by law;</li>
        <li>upload malware or content that is illegal, infringing, defamatory or obscene (for example as product photos); or</li>
        <li>share your login, or let anyone use the Service in a way that violates these rules.</li>
      </ul>

      <h2>Responsible security research</h2>
      <p>
        If you believe you have found a security issue, please tell us <ContactLine /> with enough detail to reproduce it, and give us reasonable time to fix it before disclosing it.
        Do not access or change data that isn’t yours while investigating.
      </p>

      <h2>Enforcement</h2>
      <p>
        We may investigate suspected violations and remove content, limit features, or suspend or terminate accounts, proportionate to the issue. Where appropriate we will tell you
        first and give you a chance to fix it. We may report illegal activity to the authorities.
      </p>
    </LegalPage>
  );
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
  description: "How Sheree collects, uses, shares, protects and retains personal information.",
};

const sections = [
  ["scope", "Scope and who we are"],
  ["collect", "Information we collect"],
  ["sources", "Where information comes from"],
  ["use", "How and why we use information"],
  ["sharing", "How we disclose information"],
  ["marketplace", "Marketplace and public features"],
  ["payments", "Payments"],
  ["cookies", "Cookies, analytics and marketing"],
  ["retention", "How long we keep information"],
  ["security", "Security"],
  ["transfers", "International transfers"],
  ["rights", "Your choices and rights"],
  ["regions", "Regional disclosures"],
  ["children", "Children"],
  ["changes", "Changes to this policy"],
  ["contact", "Contact us"],
] as const;

export default function PrivacyPolicy() {
  return <article className="legal-page shell">
    <header className="legal-header">
      <p className="eyebrow">Your information, treated with care</p>
      <h1>Privacy <em>Policy</em></h1>
      <p className="legal-date"><strong>Effective:</strong> 13 August 2026 &nbsp;·&nbsp; <strong>Last updated:</strong> 13 August 2026</p>
      <p className="lede">This policy explains what personal information Sheree handles, why we handle it, who receives it, how long we keep it, and the choices available to you.</p>
      <div className="legal-callout"><strong>Important pre-publication notice</strong><p>Sheree’s registered legal name, company number, registered address, Data Protection Commission registration number, privacy representative details, and final vendor list were not available in the website repository. The bracketed fields below must be completed and the policy must be checked against Sheree’s live product and data map before launch.</p></div>
    </header>

    <nav className="legal-toc" aria-label="Privacy policy contents">
      <p>Contents</p>
      <ol>{sections.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol>
    </nav>

    <div className="legal-summary">
      <h2>Privacy at a glance</h2>
      <div><p><strong>We use information to provide the service.</strong> This includes running accounts, profiles, discovery, bookings, messages, payments, reviews, support and safety features.</p><p><strong>Professionals and clients see what they need.</strong> Booking participants receive information necessary to arrange and perform an appointment. Public profile content can be seen by anyone.</p><p><strong>We do not sell personal information.</strong> We also do not share it for cross-context behavioural advertising unless we first provide the notices and choices required by law.</p><p><strong>You have control.</strong> Depending on where you live, you may access, correct, delete, restrict, object to, or receive a copy of your information, and withdraw consent.</p></div>
    </div>

    <section id="scope">
      <h2>1. Scope and who we are</h2>
      <p>This policy applies to the Sheree website, mobile applications, marketplace, communications, events and related services (together, the <strong>“Services”</strong>). “Sheree,” “we,” “us” and “our” mean <strong>Sheree</strong>, of <strong>Accra, Ghana</strong>.</p>
      <p>For information processed to operate the Services, Sheree is generally the data controller (or equivalent term under applicable law). A beauty professional may be an independent controller for information they use outside Sheree to deliver a service, comply with professional obligations, or manage their own business. Their separate privacy practices apply to that processing.</p>
      <p>This policy does not cover third-party websites, applications or services linked from Sheree, or a professional’s independent activities. It also does not form part of an employment contract. A separate workforce notice should cover employees, contractors and job applicants if applicable.</p>
      {/* <p><strong>Current website:</strong> the contact form prepares an email in your own email application; it does not submit form contents to Sheree’s website server. The current waitlist screen only displays an on-device confirmation and, as presently coded, does not transmit the entered details. This policy also describes marketplace features presented on the site that may be introduced later. We will update the notice before materially new collection begins.</p> */}
    </section>

    <section id="collect">
      <h2>2. Information we collect</h2>
      <p>The information collected depends on how you use Sheree and which features are available.</p>
      <div className="legal-table-wrap"><table><thead><tr><th>Category</th><th>Examples</th></tr></thead><tbody>
        <tr><td>Identity and account</td><td>Name, username, date of birth or age confirmation, pronouns, photo, password or authentication token, account type and identifiers.</td></tr>
        <tr><td>Contact information</td><td>Email address, telephone number, postal or business address, and communication preferences.</td></tr>
        <tr><td>Professional and verification</td><td>Business name and details, services, prices, qualifications, licences, insurance, experience, portfolio, availability, service locations, tax details, identity documents, verification results and status. We may receive verification results without retaining the underlying document.</td></tr>
        <tr><td>Bookings and transactions</td><td>Selected service, participants, appointment date and time, location, instructions, price, deposit, discounts, cancellation, refund, dispute, transaction reference and booking history.</td></tr>
        <tr><td>Payment and payout</td><td>Payment method type, masked card or bank details, billing details, payment status, fraud signals and payout account details. Full payment credentials are generally collected by our payment processor, not stored by Sheree.</td></tr>
        <tr><td>Content and communications</td><td>Profiles, portfolios, photographs and videos, saved looks, follows, reviews, ratings, messages, contact requests, survey answers, reports, support correspondence and attachments.</td></tr>
        <tr><td>Location</td><td>Approximate location from IP address, addresses you enter, and—with device permission—precise device location to show nearby professionals or support an appointment. You can withdraw device permission.</td></tr>
        <tr><td>Beauty preferences and potentially sensitive information</td><td>Hair, skin, nail or beauty preferences; accessibility needs; allergies, sensitivities, pregnancy information or health-related notes you choose to give for a safe service; and information that may reveal race or ethnicity from photographs or service choices. Please provide only what is needed.</td></tr>
        {/* <tr><td>Device and usage</td><td>IP address, browser and device type, operating system, app version, language, time zone, pages or screens viewed, links clicked, session times, referring page, crash logs, cookie identifiers and diagnostic events.</td></tr>
        <tr><td>Safety, integrity and legal</td><td>Reports, evidence, moderation decisions, blocked accounts, suspected fraud, chargebacks, identity or age checks, incident details, and records required by law.</td></tr>
        <tr><td>Inferences</td><td>Likely interests, service preferences, recommendations and risk indicators derived from activity. We do not use photos for facial recognition or biometric identification unless we give a specific notice and obtain any legally required consent.</td></tr> */}
      </tbody></table></div>
      <p>If an app requests access to your camera, photos, contacts, calendar, notifications, microphone or location, the operating system will ask permission. We use that access only for the feature shown—for example, uploading portfolio images, adding a booking to a calendar, or receiving appointment reminders. You can change permissions in device settings. Sheree should not upload an address book or calendar contents unless that feature is clearly presented and authorised.</p>
    </section>

    <section id="sources">
      <h2>3. Where information comes from</h2>
      <ul><li><strong>From you,</strong> when you create an account, profile or booking; upload content; pay; communicate; review; report a concern; enter a promotion; or contact us.</li><li><strong>Automatically,</strong> from your browser, device, app and cookies when you use the Services.</li><li><strong>From other users,</strong> such as a booking participant, professional, client, reviewer, referrer or person making a safety report.</li><li><strong>From service providers,</strong> such as payment, identity-verification, fraud-prevention, analytics, communications, hosting and support providers.</li><li><strong>From linked services,</strong> if you choose social sign-in, calendar sync or another integration.</li><li><strong>From public and lawful sources,</strong> such as professional registers, public business pages and fraud-prevention databases, where permitted.</li></ul>
      <p>If you provide information about another person, you must have authority to do so and should direct them to this policy. If we receive information indirectly, we will provide any additional notice required by law.</p>
    </section>

    <section id="use">
      <h2>4. How and why we use information</h2>
      <p>Where laws such as Ghana’s Data Protection Act, the EU GDPR or UK GDPR require a lawful basis, we rely on the bases below. More than one basis may apply, and local law may describe them differently.</p>
      <div className="legal-table-wrap"><table><thead><tr><th>Purpose</th><th>Information commonly used</th><th>Lawful basis</th></tr></thead><tbody>
        <tr><td>Provide accounts, profiles, search, recommendations, bookings, messages, payments, reviews and support</td><td>Identity, contact, professional, booking, payment, content, location and device data</td><td>Perform our contract with you; legitimate interests in operating and improving the marketplace</td></tr>
        <tr><td>Verify professionals, prevent fraud, moderate content and protect people, property and the Services</td><td>Identity, verification, transactions, device, content, reports and risk indicators</td><td>Legitimate interests in trust, safety and fraud prevention; legal obligations; substantial public interest where applicable; vital interests in emergencies</td></tr>
        <tr><td>Process payments, payouts, refunds, taxes, accounting and disputes</td><td>Identity, contact, transaction and payment data</td><td>Contract; legal obligations; legitimate interests in financial administration and legal claims</td></tr>
        <tr><td>Personalise discovery and measure, debug and improve the Services</td><td>Usage, device, location, bookings, saved content and inferences</td><td>Legitimate interests in relevant, reliable Services; consent where required for cookies, precise location or similar technologies</td></tr>
        <tr><td>Send service messages and optional marketing</td><td>Contact, account, booking and preferences</td><td>Contract or legitimate interests for service messages; consent where required for marketing</td></tr>
        <tr><td>Comply with law, enforce terms, respond to authorities and establish or defend legal claims</td><td>Any relevant category</td><td>Legal obligation; legitimate interests; legal claims</td></tr>
        <tr><td>Research, statistics and business planning</td><td>Usage, transactions and feedback, preferably aggregated or de-identified</td><td>Legitimate interests in understanding and developing the business; consent where required</td></tr>
      </tbody></table></div>
      <p>Our legitimate interests include operating a useful two-sided marketplace, keeping it secure, understanding performance, communicating with users and developing Sheree. We balance those interests against your rights and expectations. You may object as described below.</p>
      <p><strong>Special-category or sensitive information.</strong> Where information about health, race or ethnicity, biometrics, precise location or another sensitive category is protected by law, we process it only when necessary and with an additional lawful condition—usually your explicit consent, legal claims, substantial public interest, vital interests, or as otherwise permitted by law. You may decline optional sensitive information, though a professional may need relevant allergy or safety information to perform a requested service safely.</p>
      <p><strong>Automated processing.</strong> Sheree may rank search results, recommend content and flag possible fraud or policy violations. Unless we tell you otherwise at the relevant time, we do not make decisions based solely on automated processing that produce legal or similarly significant effects. Material account or safety actions should include human review, and you may contact us to challenge a decision.</p>
    </section>

    <section id="sharing">
      <h2>5. How we disclose information</h2>
      <p>We may disclose information only as reasonably necessary:</p>
      <ul><li><strong>Between booking participants.</strong> Clients and professionals receive names, contact or in-app communication details, appointment details, service location, relevant notes, status, and review information needed to arrange and complete a booking.</li><li><strong>Publicly.</strong> Professional profiles, portfolio content, business details, availability, reviews and any content you intentionally post publicly can be viewed, copied or reshared by others and may appear in search engines.</li><li><strong>To service providers.</strong> Hosting, storage, security, identity verification, payments and payouts, fraud prevention, communications, customer support, analytics, crash reporting, maps, scheduling, professional advisers and similar vendors process information under contract.</li><li><strong>To linked services.</strong> We share information when you direct us to connect an account, calendar, social network or other third-party service.</li><li><strong>For legal and safety reasons.</strong> We may disclose information to courts, regulators, law enforcement, emergency services, rights holders or affected persons when we reasonably believe it is required by law or necessary to protect rights, safety, property, users or the public; investigate fraud or abuse; enforce agreements; or respond to an emergency.</li><li><strong>In a business transaction.</strong> Information may be reviewed or transferred in a merger, financing, reorganisation, insolvency, acquisition or sale of assets, subject to appropriate confidentiality and notice required by law.</li><li><strong>With your direction or consent.</strong> We disclose information for another purpose when you ask us to or validly consent.</li></ul>
      <p>We may use and disclose aggregated or de-identified information that cannot reasonably identify you. We will not attempt to re-identify it except to test our de-identification processes or as permitted by law.</p>
    </section>

    <section id="marketplace">
      <h2>6. Marketplace and public features</h2>
      <p>Sheree connects independent beauty clients and professionals. A professional receives booking information so they can accept, prepare for and perform the service. After receipt, the professional may have their own legal duties and records. Ask them directly about their privacy practices for uses outside Sheree.</p>
      <p>Reviews should be associated with completed bookings, but may still contain opinions. We may display your first name, profile image, rating, review text, service and month of service. Do not include another person’s private or sensitive information in public content. Deleting your account may not remove content another user has a lawful reason to retain, transaction records, or de-identified information; public content may also persist in third-party copies or search caches.</p>
      <p>Messages and reports are not guaranteed to be private from Sheree. We may access or use them where needed to deliver the feature, respond to support, investigate safety or fraud, enforce rules, or comply with law. We do not monitor every interaction.</p>
    </section>

    <section id="payments">
      <h2>7. Payments</h2>
      <p>Sheree expects to use Paystack and may use other regulated payment partners to process charges, deposits, refunds and professional payouts. The payment partner collects and uses payment credentials under its own privacy notice and may act as an independent controller for fraud prevention and legal compliance. Sheree generally receives a token or reference, payment method type, masked details, amount, status and fraud signals—not full card credentials. Do not send card or bank credentials through messages or support email.</p>
      <p>Payment partners, banks and networks may conduct identity, sanctions, anti-money-laundering and fraud checks and may retain transaction records for legally required periods. Before enabling payments, Sheree must name every live payment provider and link its notice here.</p>
    </section>

    <section id="cookies">
      <h2>8. Cookies, analytics and marketing</h2>
      <p>Sheree may use cookies, pixels, local storage, mobile identifiers and similar technologies to keep you signed in, remember preferences, secure the Services, measure performance, understand use and—with permission where required—measure campaigns or personalise marketing. A cookie banner or settings tool will identify non-essential technologies in use and let you change choices. Essential technologies cannot always be disabled because the Services may not work without them.</p>
      <p>You can also use browser or device controls, but blocking technologies may affect features. Where applicable, we recognise legally required opt-out preference signals such as Global Privacy Control. A browser “Do Not Track” signal is not universally standardised; unless local law requires otherwise, our response may depend on the specific signal and technology.</p>
      <p>We may send booking, account, security and policy messages even if you opt out of marketing. You can stop promotional email through its unsubscribe link and control push notifications in device settings. We do not use sensitive information to infer characteristics for advertising, and we do not knowingly sell personal information or share it for cross-context behavioural advertising. If that changes, we will update this policy and provide required opt-outs before doing so.</p>
    </section>

    <section id="retention">
      <h2>9. How long we keep information</h2>
      <p>We keep information only as long as reasonably necessary for the purposes described, including providing the Services, maintaining security and audit trails, resolving disputes, enforcing agreements, and meeting tax, accounting, payment, anti-fraud and other legal duties. Final periods must be validated against Sheree’s operations and local law.</p>
      <div className="legal-table-wrap"><table><thead><tr><th>Record</th><th>Expected period or criterion</th></tr></thead><tbody>
        <tr><td>Account and profile</td><td>While the account is active, then normally up to 24 months after closure, unless needed longer for a reason below.</td></tr>
        <tr><td>Bookings, payments, payouts, tax and accounting</td><td>Normally 7 years after the transaction or longer if required by applicable financial law.</td></tr>
        <tr><td>Identity-verification records</td><td>Results for the account lifecycle plus a limited anti-fraud period; underlying documents only as long as necessary or retained by the verification provider.</td></tr>
        <tr><td>Messages and support</td><td>Normally up to 3 years after the conversation closes; longer when connected to a dispute, safety issue or legal claim.</td></tr>
        <tr><td>Safety, fraud, disputes and legal claims</td><td>For the investigation and applicable limitation period, and longer where litigation, a legal hold or repeat-abuse prevention requires it.</td></tr>
        <tr><td>Marketing preferences</td><td>Until opt-out or withdrawal; a minimal suppression record may be kept so we honour the choice.</td></tr>
        <tr><td>Device, analytics and cookie data</td><td>According to the cookie settings or vendor configuration, normally no longer than 25 months for identifiable analytics.</td></tr>
        <tr><td>Backups</td><td>Deleted on a rolling schedule, normally within 90 days, unless isolated for security or legal reasons.</td></tr>
      </tbody></table></div>
      <p>When information is no longer needed, we delete, anonymise or securely isolate it. Deletion from active systems may not be immediate. We may retain a minimal record of requests, consent and account bans to demonstrate compliance and prevent abuse.</p>
    </section>

    <section id="security">
      <h2>10. Security</h2>
      <p>We use administrative, technical and physical safeguards appropriate to the nature of the information and risk. These should include access controls, encryption in transit, secure credential handling, vendor review, logging, backups, vulnerability management, staff confidentiality and an incident-response process. No internet or storage system is completely secure, so we cannot guarantee absolute security.</p>
      <p>Use a unique password, protect your device and authentication codes, keep account details current, and contact us promptly at <a href="mailto:privacy@getsheree.com">privacy@getsheree.com</a> if you suspect unauthorised access. If a breach creates a risk requiring notification, we will notify affected people and regulators as required by law.</p>
    </section>

    <section id="transfers">
      <h2>11. International transfers</h2>
      <p>Sheree is intended to operate from Ghana, while providers and users may be in other countries. Information may therefore be processed in countries with different privacy laws. Where required, we use lawful safeguards such as an adequacy decision, approved standard contractual clauses (with relevant UK addendum), binding rules, consent or another permitted transfer mechanism, and assess supplementary safeguards. You may request information about applicable safeguards using the contact details below.</p>
    </section>

    <section id="rights">
      <h2>12. Your choices and rights</h2>
      <p>Subject to applicable law and exceptions, you may have the right to:</p>
      <ul><li>know whether and how we process your information and obtain access or a portable copy;</li><li>correct incomplete or inaccurate information;</li><li>delete information;</li><li>restrict processing or object to processing based on legitimate interests, direct marketing, or specified uses likely to cause unwarranted damage or distress;</li><li>withdraw consent at any time, without affecting earlier lawful processing;</li><li>opt out of sale, targeted or cross-context behavioural advertising, or certain profiling where applicable;</li><li>limit certain uses or disclosures of sensitive information where applicable;</li><li>not be subject to a solely automated decision with legal or similarly significant effects, and request human review;</li><li>appeal our refusal of a request where local law provides that right; and</li><li>complain to a privacy regulator.</li></ul>
      <p className="rights-notice"><strong>Your right to object:</strong> You may object at any time to direct marketing. You may also object, for reasons relating to your situation, when we rely on legitimate interests. We will stop unless we demonstrate compelling legitimate grounds or need the information for legal claims.</p>
      <div className="deletion-request">
        <div><h3>Delete your Sheree account and data</h3><p>Send us a deletion request from the email address connected to your account. We may need to verify your identity before completing the request. Some transaction, safety or legal records may be retained where required or permitted by law.</p></div>
        <a className="button primary" href="/account-deletion">Request account deletion</a>
      </div>
      <p>Exercise rights through available account settings or email <a href="mailto:privacy@getsheree.com">privacy@getsheree.com</a>. Describe your request and the account email or telephone number. We may verify identity proportionately and may ask an authorised agent for proof of authority. We will respond within the period required by applicable law. Requests are generally free, though we may charge or refuse where the law permits because a request is manifestly unfounded, excessive or repetitive. We will explain any refusal and appeal route.</p>
      <p>You may complain to Ghana’s <a href="https://dataprotection.org.gh/" rel="noreferrer">Data Protection Commission</a>. If you are in the EEA or UK, you may complain to the authority where you live or work (including the UK <a href="https://ico.org.uk/make-a-complaint/" rel="noreferrer">Information Commissioner’s Office</a>). We would appreciate the chance to address your concern first.</p>
    </section>

    <section id="regions">
      <h2>13. Regional disclosures</h2>
      <h3>Ghana</h3>
      <p>Sheree processes personal data in line with the data-protection principles and data-subject rights under Ghana’s Data Protection Act, 2012 (Act 843). Controller registration number: <strong>[INSERT DPC REGISTRATION NUMBER]</strong>. Nothing in this policy limits rights that cannot lawfully be limited.</p>
      <h3>European Economic Area and United Kingdom</h3>
      <p>The controller and lawful bases are identified above. If Sheree offers Services to or monitors people in the EEA or UK while not established there, add the applicable representative before launch: <strong>EEA representative [INSERT OR “NOT APPLICABLE”]</strong>; <strong>UK representative [INSERT OR “NOT APPLICABLE”]</strong>. Data Protection Officer: <strong>[INSERT CONTACT OR “NOT REQUIRED” AFTER ASSESSMENT]</strong>.</p>
      <h3>United States</h3>
      <p>Residents of California and other US states with comprehensive privacy laws may have the rights to confirm processing, access, correct, delete and obtain portable data; opt out of sale, targeted advertising and certain profiling; limit certain sensitive-data uses; appeal; and receive equal service. The exact rights depend on the state and whether its law applies to Sheree.</p>
      <p>For the preceding 12 months, Sheree may have collected the categories described in section 2; used them for section 4 purposes; and disclosed them to the recipient categories in section 5. These may correspond to identifiers; customer records; protected characteristics where volunteered or apparent; commercial information; internet activity; geolocation; audio/visual information; professional information; inferences; and sensitive personal information. We retain each as described in section 9. We do not knowingly sell these categories or share them for cross-context behavioural advertising, and we do not knowingly sell or share information of people under 16.</p>
      <p>We do not offer a financial incentive in exchange for personal information. If we introduce one, we will provide its material terms before enrolment. California residents may use an authorised agent; we may verify the request and authority as permitted by law. Contact us to exercise applicable rights or appeal a decision.</p>
      <h3>Other locations</h3>
      <p>Where another applicable law grants additional rights or imposes stricter requirements, we will honour them. Contact us if you believe a local right is not described here.</p>
    </section>

    <section id="children">
      <h2>14. Children</h2>
      <p>The Services are not directed to children under 18, and they may not create an account or book or provide services through Sheree. We do not knowingly collect personal information from a child. If you believe a child has provided information, contact us so we can investigate and delete it as required. If Sheree later permits teen accounts, it must first introduce age-appropriate notices, parental or guardian consent where required, protective defaults and controls appropriate to the country of use.</p>
    </section>

    <section id="changes">
      <h2>15. Changes to this policy</h2>
      <p>We may update this policy to reflect changes in the Services, vendors, law or our practices. We will post the updated version and change the “Last updated” date. If a change is material, we will provide additional notice—such as an in-app message or email—and obtain consent when required before the change takes effect. Previous versions will be available on request.</p>
    </section>

    <section id="contact">
      <h2>16. Contact us</h2>
      <p>Questions, complaints and rights requests can be sent to:</p>
      <address><strong>Privacy Team / Data Protection Officer</strong><br/>Raphael Wright Agbedanu<br/>Tesano, Ghana<br/>Email: <a href="mailto:ralph@sheree.world">ralph@sheree.world</a><br/>General support: <a href="mailto:hello@sheree.world">hello@sheree.world</a><br/>Telephone: 0209003775</address>
      <p>If a Data Protection Officer has not been appointed, replace that title with the person or team responsible for privacy. Keep a monitored channel capable of receiving and tracking rights requests.</p>
    </section>
  </article>;
}

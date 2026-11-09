import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: "/terms" },
  description: "The terms governing your access to and use of the Sheree mobile application and related services.",
};

const sections = [
  ["service-provider", "The service provider"],
  ["about", "About the platform"],
  ["eligibility", "Eligibility"],
  ["accounts", "Accounts and registration"],
  ["customers", "Customers — discovery, booking, and payment"],
  ["payments", "Payments, deposits, and commission"],
  ["payouts", "Professionals — payouts"],
  ["cancellation", "Cancellation and refunds"],
  ["reviews", "Reviews, ratings, and user content"],
  ["ip", "Intellectual property"],
  ["prohibited", "Prohibited conduct"],
  ["suspension", "Suspension and termination"],
  ["disputes", "Dispute resolution, reports, and trust & safety"],
  ["changes", "Changes to the platform and these terms"],
  ["disclaimers", "Disclaimers"],
  ["liability", "Limitation of liability"],
  ["indemnification", "Indemnification"],
  ["third-party", "Third-party services and links"],
  ["privacy", "Privacy"],
  ["general", "General provisions"],
  ["contact", "Contact us"],
] as const;

export default function TermsOfService() {
  return <article className="legal-page shell">
    <header className="legal-header">
      <p className="eyebrow">How Sheree works</p>
      <h1>Terms of <em>Service</em></h1>
      <p className="legal-date"><strong>Effective:</strong> 1st September 2026 &nbsp;·&nbsp; <strong>Last updated:</strong> 1st September 2026</p>
      <p className="lede">These terms govern your access to and use of the Sheree mobile application and related services — the marketplace that connects customers and professionals for appointment-based services.</p>
      <div className="legal-callout"><strong>Important pre-publication notice</strong><p>Sheree’s registered legal name, company number, registered business address, and final support contact details were not available in the website repository. The bracketed fields below must be completed and these terms reviewed by a qualified legal professional in the jurisdictions in which Sheree operates before publishing them. This document is provided as a foundation for Sheree’s Terms of Service and is not legal advice.</p></div>
    </header>

    <nav className="legal-toc" aria-label="Terms of service contents">
      <p>Contents</p>
      <ol>{sections.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol>
    </nav>

    <div className="legal-summary">
      <h2>Terms at a glance</h2>
      <div><p><strong>Sheree is a marketplace and technology platform only.</strong> It connects customers with independent professionals and is not a party to any agreement between them, nor the provider of any service.</p><p><strong>Bookings are secured by a deposit.</strong> For completed bookings, Sheree retains a 10% platform commission; the professional receives the remaining deposit as a payout. Cancellations and refunds are handled per the applicable policy.</p><p><strong>Professionals are independent.</strong> Each professional is an independent contractor or business, not an employee, agent, partner, or joint venturer of Sheree.</p><p><strong>Reviews are verified.</strong> Only customers who have completed a booking can review a professional. By using Sheree, you agree to these terms and our <a href="/privacy">Privacy Policy</a>.</p></div>
    </div>

    <section id="service-provider">
      <h2>1. The service provider</h2>
      <p>The Platform is operated by or on behalf of <strong>Sheree PLC</strong> (“Sheree,” “we,” “us,” or “our”), a company organized under the laws of the Republic of Ghana, with its principal place of business at <strong>Tesano, Ghana</strong>.</p>
      <p>For all enquiries relating to these Terms, your account, bookings, payments, or disputes, you may contact us at:</p>
      <ul><li><strong>Email:</strong> support@sheree.world</li><li><strong>Postal Address:</strong> Tesano, Ghana</li></ul>
    </section>

    <section id="about">
      <h2>2. About the platform</h2>
      <p>Sheree is a social-first marketplace that connects two types of users:</p>
      <ol><li><strong>Customers</strong> — individuals who discover, book, and pay for appointment-based services.</li><li><strong>Professionals</strong> — independent service providers who list services, showcase their work, manage their schedules, accept bookings, and receive payments.</li></ol>
      <p>The Platform enables Customers to:</p>
      <ul><li>Discover Professionals through a personalized feed, search, and category browsing;</li><li>View verified portfolios, services, pricing, ratings, and real-time availability;</li><li>Book appointments, pay deposits securely, communicate with Professionals, and manage bookings in one place;</li><li>Save Professionals, posts, and inspirations; and</li><li>Leave verified reviews for completed appointments.</li></ul>
      <p>The Platform enables Professionals to:</p>
      <ul><li>Create a business profile and portfolio;</li><li>List services, set pricing, availability, working hours, travel radius, and cancellation policies;</li><li>Accept and manage bookings and their calendar;</li><li>Receive deposits and payouts; and</li><li>Grow their business and build client relationships.</li></ul>
      <p><strong>Sheree is a marketplace and technology platform only.</strong> Sheree is not a party to any agreement between a Customer and a Professional, is not the provider of any service, and does not employ or otherwise engage any Professional. All services are provided solely by the Professionals who list them, and each Professional is an independent contractor or independent business, not an employee, agent, partner, or joint venturer of Sheree. The selection, quality, safety, legality, and performance of any service provided by a Professional is the sole responsibility of that Professional.</p>
    </section>

    <section id="eligibility">
      <h2>3. Eligibility</h2>
      <p>You must be at least <strong>18 years of age</strong> (or the age of majority in your jurisdiction, whichever is greater) to use the Platform or create an account. By using the Platform, you represent and warrant that:</p>
      <ul><li>You are at least 18 years of age;</li><li>You have the full power and authority to enter into and perform your obligations under these Terms;</li><li>The information you provide to us is accurate, current, and complete; and</li><li>You will keep your account information updated.</li></ul>
      <p>If you are using the Platform on behalf of a business or other entity, you represent and warrant that you are authorized to bind that entity to these Terms.</p>
      <p>The Platform is not intended for, and we do not knowingly collect information from, children under the age of 13. If you believe a child has provided us personal information, contact us at support@sheree.world.</p>
    </section>

    <section id="accounts">
      <h2>4. Accounts and registration</h2>
      <h3>4.1 Creating an account</h3>
      <p>To use most features of the Platform, you must create an account using a valid email address and a secure password, or through an authorized third-party sign-in method. You may also be able to browse certain content in a limited “guest” mode.</p>
      <h3>4.2 Account responsibilities</h3>
      <p>You are responsible for:</p>
      <ul><li>Maintaining the confidentiality of your login credentials;</li><li>All activity that occurs under your account; and</li><li>Notifying us immediately of any unauthorized use of your account or breach of security.</li></ul>
      <p>You must not share your password, allow another person to use your account, or use another person’s account.</p>
      <h3>4.3 Customer and professional roles</h3>
      <p>You may register as a Customer, a Professional, or both (where we permit mode switching). A single account may hold a Customer profile and a Professional profile. Each role is subject to the applicable terms in these Terms.</p>
      <h3>4.4 Verification</h3>
      <p>Professionals may be required to complete identity verification and business verification processes, which may include submitting government-issued identification and other documents. We may display a “Verified” badge on verified Profiles. Verification confirms the identity information provided at the time of verification only; it is not a guarantee of a Professional’s skill, qualifications, conduct, or the quality of any service.</p>
    </section>

    <section id="customers">
      <h2>5. Customers — discovery, booking, and payment</h2>
      <h3>5.1 Services and pricing</h3>
      <p>Professionals set their own services, pricing, durations, availability, travel fees, and cancellation policies. Prices displayed on the Platform are in Ghanaian Cedi (GH₵) unless otherwise stated. The total price of an appointment may include a <strong>deposit amount</strong> and a <strong>balance amount</strong> payable as described in Section 6.</p>
      <h3>5.2 Booking process</h3>
      <p>To book an appointment, you must:</p>
      <ol><li>Select a service, date, and available time slot;</li><li>Review the appointment summary, including deposit, balance, duration, and cancellation policy;</li><li>Pay the required deposit through the Platform’s payment provider; and</li><li>Receive a booking confirmation.</li></ol>
      <p>Bookings are subject to the Professional’s availability, working hours, breaks, time off, and booking window. Appointments generally must be booked at least <strong>one (1) hour</strong> in advance, and within the Professional’s stated booking window (which may be up to 60 days or as otherwise configured). A booking is only confirmed once the deposit has been successfully processed.</p>
      <h3>5.3 Mobile services</h3>
      <p>Some Professionals offer mobile (“on-location”) services. If you select a mobile service, a travel fee may apply, and the Professional will travel to the location you provide. You are responsible for providing an accurate location and ensuring the Professional has reasonable access to the appointment location.</p>
      <h3>5.4 Customer obligations</h3>
      <p>By booking an appointment, you agree to:</p>
      <ul><li>Provide accurate information, including your contact details and appointment location;</li><li>Attend your appointment at the scheduled time, or cancel or reschedule in accordance with the applicable cancellation policy; and</li><li>Conduct yourself respectfully toward Professionals.</li></ul>
    </section>

    <section id="payments">
      <h2>6. Payments, deposits, and commission</h2>
      <h3>6.1 Payment processing</h3>
      <p>Payments are processed by our payment service providers, including Paystack and its affiliates. The Platform supports payment by Mobile Money, card, and bank transfer (as available). By making a payment, you authorize Sheree and its payment providers to charge your chosen payment method for the applicable amounts.</p>
      <h3>6.2 Deposits</h3>
      <p>Customers are required to pay a <strong>deposit</strong> (a percentage of the service price, as configured by the Professional, for example 50%) to secure a booking. The deposit is collected by Sheree on behalf of the Professional and held pending the outcome of the appointment. The remaining <strong>balance</strong> is payable to the Professional for the service, as and when agreed (which may be at the appointment or through the Platform, as configured).</p>
      <h3>6.3 Platform commission</h3>
      <p>For completed bookings, Sheree retains a <strong>platform commission</strong> equal to <strong>10% of the full service price</strong>, deducted from the collected deposit. The Professional receives the remaining deposit proceeds (i.e., deposit amount less platform commission) as a payout in accordance with Section 7. Commission rates may be updated from time to time, and any changes will be communicated to Professionals before taking effect.</p>
      <h3>6.4 Taxes</h3>
      <p>You are solely responsible for any taxes (including value-added tax, sales tax, or similar) that apply to your use of the Platform, your transactions, and any income you earn as a Professional. Sheree does not provide tax advice. Where required by law, we may collect and remit applicable taxes on transactions.</p>
    </section>

    <section id="payouts">
      <h2>7. Professionals — payouts</h2>
      <h3>7.1 Payout account</h3>
      <p>To receive payouts, Professionals must connect a valid payout account supported by the Platform (including Ghana Interbank Payment and Settlement System (GHIPSS) bank transfers and Mobile Money). You are responsible for providing accurate and complete payout information and for updating it as needed.</p>
      <h3>7.2 Payouts on completion</h3>
      <p>When a booking is completed, Sheree will initiate a payout to the Professional’s payout account for the amount equal to the deposit collected less the platform commission (Section 6.3). Payouts are subject to the processing timelines of our payment providers and may take time to appear in your account.</p>
      <h3>7.3 Payout status and errors</h3>
      <p>Payout statuses include pending, processing, paid, failed, and reversed. If a payout fails or is reversed, Sheree will notify you and may retry the payout after review. You must maintain accurate payout details; Sheree is not liable for payouts sent to an account based on information you provided that later proves incorrect, though we will work in good faith to resolve errors.</p>
      <h3>7.4 Professional obligations</h3>
      <p>By listing services as a Professional, you agree to:</p>
      <ul><li>Accurately represent your identity, qualifications, experience, services, pricing, and availability;</li><li>Honor confirmed bookings and provide the services you list at the agreed time and price;</li><li>Maintain your calendar and availability, and honor your stated working hours and time off;</li><li>Comply with all applicable laws and regulations relating to your business and the services you provide, including any licenses, permits, or insurance required;</li><li>Conduct yourself professionally and respectfully toward Customers; and</li><li>Keep your profile, portfolio, and service information accurate and up to date.</li></ul>
    </section>

    <section id="cancellation">
      <h2>8. Cancellation and refunds</h2>
      <p>Cancellation and refund terms are important. Please read them carefully.</p>
      <h3>8.1 Cancellation by customer</h3>
      <p>Customers may cancel a booking from the Platform in accordance with the applicable cancellation policy.</p>
      <ul><li><strong>Customer cancellation:</strong> Where the Professional’s cancellation policy permits and subject to the applicable policy, <strong>90% of the deposit</strong> will be refunded to the Customer, and the remaining <strong>10% of the deposit</strong> will be paid to the Professional as compensation for the cancelled appointment. Refunds are processed by our payment providers and may take time to appear in your account. Refund statuses include pending, processing, refunded, and failed.</li><li>If a refund fails, Sheree will notify you and will work to retry the refund. Where a refund cannot be processed, Sheree will provide you with a support reference and assistance.</li></ul>
      <h3>8.2 Cancellation by professional</h3>
      <p>If a Professional cancels a booking, the <strong>full deposit will be refunded to the Customer</strong>, and no professional compensation will be paid to the Professional. In such cases, Sheree may also take action in accordance with Section 12 for repeated cancellations.</p>
      <h3>8.3 Rescheduling</h3>
      <p>Customers and Professionals may reschedule a booking to an available time slot, subject to availability, the booking window, and the Professional’s schedule. Rescheduling is not guaranteed and is subject to the availability shown in the Platform.</p>
      <h3>8.4 No-show and late arrival</h3>
      <p>If a Customer fails to attend a confirmed appointment without cancelling in accordance with the applicable policy, the Professional may apply the applicable no-show or late-arrival terms of their cancellation policy. Professionals may not impose fees or retain deposits beyond what is permitted by these Terms and their stated policy.</p>
      <h3>8.5 Disputes over cancellations and refunds</h3>
      <p>If you believe a cancellation or refund was handled incorrectly, you may report the issue through the Platform’s support and dispute resolution process (Section 13). Sheree will review the matter in accordance with the available evidence and these Terms.</p>
    </section>

    <section id="reviews">
      <h2>9. Reviews, ratings, and user content</h2>
      <h3>9.1 Verified reviews</h3>
      <p>Reviews may only be submitted by <strong>verified Customers who have completed a booking</strong> with the Professional concerned. Each booking may be reviewed once. Reviews are intended to reflect the Customer’s genuine experience. Sheree may remove or reject reviews that violate these Terms.</p>
      <h3>9.2 User content</h3>
      <p>The Platform allows you to post, upload, or transmit content, including profile information, portfolio images and videos, feed posts, service descriptions, photos, comments, and messages (“User Content”). You retain all ownership rights in your User Content.</p>
      <p>By posting User Content, you grant Sheree a non-exclusive, worldwide, royalty-free, sublicensable, and transferable license to use, reproduce, modify, adapt, publish, distribute, publicly display, and perform your User Content, in whole or in part, in connection with operating, improving, and promoting the Platform (including through third-party services such as push notification, storage, and analytics providers), and to create derivative works. You also grant each user of the Platform a non-exclusive license to access your User Content through the Platform as permitted by its functionality.</p>
      <h3>9.3 Content standards</h3>
      <p>You represent and warrant that:</p>
      <ul><li>You own or have all necessary rights, licenses, and permissions to post your User Content;</li><li>Your User Content does not infringe the intellectual property, privacy, publicity, or other rights of any third party;</li><li>Your User Content does not violate applicable law or these Terms; and</li><li>You have obtained any necessary consent from individuals depicted in your User Content.</li></ul>
      <p>You must not post User Content that is unlawful, defamatory, obscene, harassing, threatening, hateful, fraudulent, misleading, sexually explicit, or otherwise objectionable, as determined by Sheree in its reasonable discretion.</p>
    </section>

    <section id="ip">
      <h2>10. Intellectual property</h2>
      <h3>10.1 Sheree IP</h3>
      <p>The Platform, including its software, design, text, graphics, logos, trademarks (including “Sheree” and the Sheree logo), and all other content not provided by users, is owned by Sheree or its licensors and is protected by copyright, trademark, and other intellectual property laws. You may not copy, modify, distribute, sell, lease, or create derivative works from any Sheree intellectual property without our prior written consent.</p>
      <h3>10.2 License to use the Platform</h3>
      <p>Subject to your compliance with these Terms, Sheree grants you a limited, non-exclusive, non-transferable, revocable license to access and use the Platform for your personal, non-commercial use (or, for Professionals, to operate their business as permitted by these Terms). This license does not permit you to resell, reverse engineer, scrape, or otherwise misuse the Platform.</p>
      <h3>10.3 Copyright and trademark complaints</h3>
      <p>We respect the intellectual property rights of others. If you believe that content on the Platform infringes your copyright, you may submit a notice to us at support@sheree.world, including a description of the allegedly infringing work, the location of the infringing material, and your contact information.</p>
    </section>

    <section id="prohibited">
      <h2>11. Prohibited conduct</h2>
      <p>You agree not to, and not to attempt to:</p>
      <ul><li>Use the Platform for any unlawful purpose or in violation of any applicable law or regulation;</li><li>Create false, fraudulent, or misleading accounts or profiles, impersonate others, or misrepresent your identity, qualifications, or services;</li><li>Harass, abuse, threaten, defame, or discriminate against any user, Professional, or Sheree personnel;</li><li>Post or transmit malware, viruses, or any harmful code;</li><li>Attempt to gain unauthorized access to the Platform, its systems, or other users’ accounts;</li><li>Scrape, harvest, or collect user data without authorization;</li><li>Interfere with or disrupt the Platform, its servers, or networks;</li><li>Use the Platform to book services fraudulently, or to pay for services outside the Platform to evade commission or fees;</li><li>Reverse engineer, decompile, or attempt to derive the source code of the Platform;</li><li>Engage in any activity that could damage, disable, or impair the Platform or its operation; or</li><li>Encourage or enable any other person to do any of the foregoing.</li></ul>
    </section>

    <section id="suspension">
      <h2>12. Suspension and termination</h2>
      <h3>12.1 By Sheree</h3>
      <p>We may suspend or terminate your account or access to the Platform, in whole or in part, at any time and for any reason, including, without limitation, if we reasonably believe that you have violated these Terms, engaged in fraudulent or abusive activity, posed a safety risk to other users, or if required by law. Where practical and lawful, we will provide notice before or after such action.</p>
      <p>Repeated cancellations, no-shows, disputes, or other conduct that adversely affects other users may result in suspension or termination.</p>
      <h3>12.2 By you</h3>
      <p>You may stop using the Platform at any time and may delete your account using the account deletion feature in the Platform (which requires confirmation), or by contacting us at support@sheree.world.</p>
      <h3>12.3 Effect of termination</h3>
      <p>Upon termination, your right to access and use the Platform ceases immediately. Sections of these Terms that by their nature should survive termination will survive, including Sections 6, 9, 10, 15, 16, 17, 18, and 20. Termination does not affect obligations already accrued, and pending bookings, payments, and disputes will be resolved in accordance with these Terms.</p>
      <h3>12.4 Account deletion</h3>
      <p>When you delete your account, we will remove or anonymize your profile and associated data to the extent described in our <a href="/privacy">Privacy Policy</a>. Some information may be retained where required by law or for legitimate business purposes, such as records of completed transactions.</p>
    </section>

    <section id="disputes">
      <h2>13. Dispute resolution, reports, and trust & safety</h2>
      <h3>13.1 Reporting</h3>
      <p>You may report another user, a booking, or content through the Platform’s reporting features or by contacting us. We will review reports in accordance with our trust and safety practices and may take action, including removal of content, suspension of accounts, or referral to authorities, as appropriate.</p>
      <h3>13.2 Disputes between users</h3>
      <p>Sheree offers a dispute resolution process to help Customers and Professionals resolve disputes relating to bookings, deposits, refunds, and services. You agree to use reasonable efforts to resolve disputes directly with the other party before escalating to Sheree. Sheree may, in its sole discretion and where permitted by applicable law, investigate disputes and make determinations, which may include issuing refunds or adjusting payouts.</p>
      <h3>13.3 Disputes with Sheree</h3>
      <p>To the fullest extent permitted by law, any dispute arising out of or relating to these Terms or your use of the Platform will be resolved as follows:</p>
      <ul><li><strong>Informal Resolution:</strong> You agree to contact us first at support@sheree.world to resolve the dispute informally.</li><li><strong>Governing Law:</strong> These Terms are governed by and construed in accordance with the laws of the Republic of Ghana, without regard to conflict-of-law principles.</li><li><strong>Jurisdiction:</strong> Any dispute not resolved informally will be subject to the exclusive jurisdiction of the courts of Ghana. To the fullest extent permitted by law, you waive any right to a class action and agree to resolve disputes on an individual basis.</li></ul>
    </section>

    <section id="changes">
      <h2>14. Changes to the platform and these terms</h2>
      <h3>14.1 Changes to terms</h3>
      <p>We may update these Terms from time to time. When we make material changes, we will notify you through the Platform (for example, via in-app notice or email) before the changes take effect. Your continued use of the Platform after the effective date of the revised Terms constitutes your acceptance of the revised Terms. If you do not agree to the revised Terms, you should stop using the Platform.</p>
      <h3>14.2 Changes to the platform</h3>
      <p>We may modify, suspend, or discontinue any part of the Platform at any time, with or without notice, and will not be liable to you for any such change, suspension, or discontinuation.</p>
    </section>

    <section id="disclaimers">
      <h2>15. Disclaimers</h2>
      <p><strong>THE PLATFORM IS PROVIDED ON AN “AS IS” AND “AS AVAILABLE” BASIS, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND ANY WARRANTIES ARISING FROM COURSE OF DEALING OR USAGE OF TRADE.</strong></p>
      <p>To the fullest extent permitted by applicable law, Sheree does not warrant that:</p>
      <ul><li>The Platform will be uninterrupted, timely, secure, or error-free;</li><li>The results obtained from the use of the Platform will be accurate or reliable;</li><li>The quality of any services, products, content, or information obtained through the Platform will meet your expectations; or</li><li>Any Professionals, their qualifications, or the services they provide are vetted, guaranteed, or endorsed by Sheree.</li></ul>
      <p><strong>Sheree is not responsible or liable for the acts, omissions, conduct, or performance of any Professional or Customer, including the quality, safety, or legality of any service provided.</strong> All services are provided by independent Professionals. You assume all risks associated with the services you book and receive.</p>
    </section>

    <section id="liability">
      <h2>16. Limitation of liability</h2>
      <p>To the fullest extent permitted by applicable law:</p>
      <ul><li>In no event will Sheree, its officers, directors, employees, agents, affiliates, or licensors be liable to you for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, revenue, data, goodwill, or other intangible losses, arising out of or relating to your use of, or inability to use, the Platform, even if Sheree has been advised of the possibility of such damages.</li><li>To the fullest extent permitted by law, Sheree’s total aggregate liability arising out of or relating to these Terms or your use of the Platform will not exceed the greater of: (a) the total amounts you paid to Sheree through the Platform in the twelve (12) months preceding the event giving rise to the claim; or (b) <strong>GH₵ 1,000</strong>.</li><li>Nothing in these Terms limits or excludes liability that cannot be limited or excluded under applicable law, including for death or personal injury caused by negligence or for fraud.</li></ul>
    </section>

    <section id="indemnification">
      <h2>17. Indemnification</h2>
      <p>You agree to indemnify, defend, and hold harmless Sheree, its officers, directors, employees, agents, affiliates, and licensors from and against any and all claims, liabilities, damages, losses, costs, and expenses (including reasonable legal fees) arising out of or relating to:</p>
      <ul><li>Your use of the Platform;</li><li>Your User Content;</li><li>Your breach of these Terms;</li><li>Your violation of any applicable law or the rights of any third party; or</li><li>Your interactions with other users, including any service you provide or receive.</li></ul>
    </section>

    <section id="third-party">
      <h2>18. Third-party services and links</h2>
      <p>The Platform may integrate with or link to third-party services, including payment providers (such as Paystack), cloud storage, analytics, and other service providers. These third-party services are subject to their own terms and privacy policies, and Sheree is not responsible for them. Your use of third-party services is at your own risk.</p>
    </section>

    <section id="privacy">
      <h2>19. Privacy</h2>
      <p>Your use of the Platform is subject to our <a href="/privacy">Privacy Policy</a>, which explains how we collect, use, share, and protect your personal information, including information collected through location services, notifications, and photo/media permissions. By using the Platform, you consent to the collection and use of your information as described in the Privacy Policy.</p>
    </section>

    <section id="general">
      <h2>20. General provisions</h2>
      <h3>20.1 Entire agreement</h3>
      <p>These Terms, together with our <a href="/privacy">Privacy Policy</a> and any other policies referenced herein, constitute the entire agreement between you and Sheree regarding your use of the Platform and supersede all prior agreements and understandings.</p>
      <h3>20.2 Severability</h3>
      <p>If any provision of these Terms is held to be invalid or unenforceable, that provision will be modified to the minimum extent necessary to make it valid and enforceable, and the remaining provisions will remain in full force and effect.</p>
      <h3>20.3 No waiver</h3>
      <p>Our failure to enforce any provision of these Terms will not constitute a waiver of that provision or any other provision.</p>
      <h3>20.4 Assignment</h3>
      <p>You may not assign or transfer your rights or obligations under these Terms without our prior written consent. Sheree may assign or transfer these Terms, in whole or in part, without restriction.</p>
      <h3>20.5 Notices</h3>
      <p>We may provide notices to you via the Platform, push notification, email, or other means reasonably calculated to reach you. You consent to receive communications from us electronically.</p>
      <h3>20.6 Force majeure</h3>
      <p>Sheree will not be liable for any failure or delay in performing its obligations under these Terms resulting from causes beyond its reasonable control, including natural disasters, acts of government, power or network failures, or other events.</p>
      <h3>20.7 Language</h3>
      <p>These Terms may be translated into other languages for convenience. In the event of any conflict between the English version and a translated version, the English version will prevail.</p>
    </section>

    <section id="contact">
      <h2>21. Contact us</h2>
      <p>If you have any questions about these Terms, please contact us at:</p>
      <ul><li><strong>Email:</strong> support@sheree.world</li><li><strong>Postal Address:</strong> Tesano, Ghana</li></ul>
    </section>
  </article>;
}

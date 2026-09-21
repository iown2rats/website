import { Bullets, Clause, ContactBlock, LegalDocument, LegalFooter, Mail, P } from "@/components/features/legal/legal-document";

export const metadata = {
  title: "Terms & Conditions",
  description: "The agreement between you and MelloCrush covering your use of www.mellocrush.com and the MelloCrush service.",
  alternates: { canonical: "/terms" },
};

/**
 * Terms & Conditions, supplied by the operator on 21 September 2026 and reproduced here verbatim
 * (docs/ARCHITECTURE.md §27). Nothing on this page is invented: no registered address, no company number, no
 * clause the operator did not write. Changing the words is a decision for the operator, not a code change.
 */
export default function TermsPage() {
  return (
    <>
      <LegalDocument
        title="Terms &amp; Conditions"
        effective="21 September 2026"
        updated="21 September 2026"
        lead={
          <>
            <P>Welcome to MelloCrush.</P>
            <P>
              These Terms &amp; Conditions (“Terms”) form an agreement between you and MelloCrush (“MelloCrush”, “we”, “us” or “our”) and govern your access
              to and use of www.mellocrush.com and related MelloCrush services and features (collectively, the “Service”).
            </P>
            <P>By creating an account or using MelloCrush, you agree to these Terms, our Privacy Policy and our Community Guidelines.</P>
            <P>If you do not agree, you must not use MelloCrush.</P>
          </>
        }
      >
        <Clause n={1} title="About MelloCrush">
          <P>MelloCrush is an online dating and social discovery platform primarily designed for adults in the Maldives.</P>
          <P>
            MelloCrush allows users to create profiles, discover other users, express interest, match, communicate, participate in Community features and
            access free or paid features.
          </P>
          <P>
            MelloCrush provides the technology that enables users to discover and communicate with each other. We do not arrange, supervise or guarantee
            relationships, dates, meetings or interactions between users.
          </P>
        </Clause>

        <Clause n={2} title="You Must Be 18 or Older">
          <P>MelloCrush is strictly for people aged 18 years or older.</P>
          <P>By creating an account, you confirm that:</P>
          <Bullets
            items={[
              "you are at least 18;",
              "you are legally capable of agreeing to these Terms;",
              "information you provide is truthful;",
              "you are not impersonating another person;",
              "you are legally permitted to use the Service; and",
              "you will comply with applicable Maldivian law and these Terms.",
            ]}
          />
          <P>We may request information reasonably necessary to verify your age or identity.</P>
          <P>
            If we reasonably believe an account belongs to someone under 18, we may immediately restrict or suspend the account while investigating and
            permanently remove it where appropriate.
          </P>
          <P>
            Users should immediately report suspected underage accounts through MelloCrush or <Mail address="safety@mellocrush.com" />.
          </P>
        </Clause>

        <Clause n={3} title="Your Account">
          <P>MelloCrush may provide authentication through Google, Telegram, email/password or other authentication methods introduced in the future.</P>
          <P>You are responsible for maintaining the security of your account.</P>
          <P>An account must represent the person operating it. You may not sell, transfer or give another person control of your account.</P>
          <P>You must notify us if you reasonably believe your account has been compromised.</P>
          <P>Where email verification is required, access to certain features may remain restricted until verification is completed.</P>
        </Clause>

        <Clause n={4} title="Authentic Profiles">
          <P>MelloCrush is intended for genuine connections between real people.</P>
          <P>You must not:</P>
          <Bullets
            items={[
              "impersonate another person;",
              "create a deceptive fake identity;",
              "intentionally provide a false age;",
              "use another person’s photographs as your own;",
              "materially misrepresent your identity;",
              "create an account for another person without authorization; or",
              "operate accounts intended to manipulate MelloCrush.",
            ]}
          />
          <P>We may require additional verification where reasonably appropriate.</P>
        </Clause>

        <Clause n={5} title="Profile Photos">
          <P>Photos submitted to MelloCrush may be moderated.</P>
          <P>We may approve, reject, restrict or remove photos that violate these Terms, our Community Guidelines or applicable law.</P>
          <P>Profile photos must not contain prohibited sexual content, exploitation, unlawful material or content violating another person’s rights.</P>
          <P>Submitting a photo does not guarantee approval.</P>
          <P>MelloCrush may use automated systems and/or human moderation to assist with photo review.</P>
        </Clause>

        <Clause n={6} title="Discovery, Likes and Matching">
          <P>MelloCrush allows users to discover profiles and express interest through likes, swipes or similar features.</P>
          <P>Users may become a match when the applicable matching conditions are satisfied.</P>
          <P>
            Discovery and recommendations may take into account information such as profile preferences, general location, account activity, interactions and
            other relevant platform signals.
          </P>
          <P>A recommendation, verification badge, like or match does not constitute an endorsement or guarantee by MelloCrush regarding another person.</P>
        </Clause>

        <Clause n={7} title="Messaging">
          <P>Users who meet MelloCrush’s messaging requirements may communicate privately.</P>
          <P>You are responsible for what you send.</P>
          <P>
            You must not use messaging to harass, threaten, blackmail or defraud another person; repeatedly contact someone who has asked you to stop; send
            unsolicited sexually explicit content; distribute malicious links; promote unlawful activities; or share another person’s private information
            without permission.
          </P>
          <P>
            Relevant communications may be processed where reasonably necessary to investigate reports, enforce our rules, prevent fraud, protect users or
            comply with legal obligations.
          </P>
        </Clause>

        <Clause n={8} title="Consent and Boundaries">
          <P>
            A match, like, message or agreement to meet does not constitute consent to sexual activity, sexual messages, intimate images, physical contact or
            any other activity.
          </P>
          <P>Consent may be withdrawn.</P>
          <P>If another user says no, asks you to stop, blocks you or otherwise withdraws consent to an interaction, you must respect that decision.</P>
        </Clause>

        <Clause n={9} title="Community">
          <P>MelloCrush may provide Community features allowing users to publish posts, comments, reactions or other content.</P>
          <P>Community content may be visible to multiple users and may be moderated.</P>
          <P>
            Community must not be used to publicly shame another user, expose private conversations, publish private information or organize harassment.
          </P>
          <P>Our Community Guidelines apply to Community activity.</P>
        </Clause>

        <Clause n={10} title="Prohibited Use">
          <P>You may not use MelloCrush to engage in or facilitate:</P>
          <Bullets
            items={[
              "illegal activity;",
              "exploitation of minors;",
              "sexual exploitation;",
              "human trafficking;",
              "prostitution or commercial sexual services;",
              "non-consensual intimate content;",
              "scams or fraud;",
              "extortion or blackmail;",
              "stalking;",
              "harassment;",
              "credible threats;",
              "violence;",
              "hate or targeted abuse;",
              "impersonation or catfishing;",
              "sale or promotion of illegal goods or services;",
              "malware or phishing;",
              "unauthorized scraping;",
              "unauthorized automated account activity;",
              "manipulation of MelloCrush systems;",
              "payment fraud; or",
              "ban evasion.",
            ]}
          />
        </Clause>

        <Clause n={11} title="Commercial Sexual Services">
          <P>MelloCrush is a dating and social discovery platform.</P>
          <P>
            MelloCrush must not be used to advertise, request, purchase, sell, arrange or facilitate prostitution, escort services, paid sexual activity,
            sexual exploitation, human trafficking or other commercial sexual services.
          </P>
          <P>Violations may result in permanent removal.</P>
        </Clause>

        <Clause n={12} title="Scams and Financial Solicitation">
          <P>MelloCrush must not be used to deceive or manipulate people into transferring money, cryptocurrency, investments, gifts or other financial assets.</P>
          <P>Users should be cautious if another user asks for money, cryptocurrency, bank credentials, investment funds or financial assistance.</P>
          <P>Suspected financial exploitation may result in restriction or termination.</P>
        </Clause>

        <Clause n={13} title="Blocking and Reporting">
          <P>Users may block or report other users where these features are available.</P>
          <P>Reports may be reviewed using automated systems and/or authorized human moderation.</P>
          <P>
            Depending on the circumstances, MelloCrush may take no action, remove content, reject a photo, issue a warning, restrict functionality, require
            verification, suspend an account or permanently terminate an account.
          </P>
          <P>
            We will not normally disclose the identity of a reporting user to the reported user except where disclosure is required by applicable law.
          </P>
          <P>Knowingly submitting malicious or deliberately false reports may itself violate these Terms.</P>
        </Clause>

        <Clause n={14} title="Serious Off-Platform Behaviour">
          <P>
            MelloCrush may consider credible reports of serious harmful behaviour occurring outside the Service where the conduct involves users who connected
            through MelloCrush or creates a significant safety risk.
          </P>
          <P>This may include credible reports involving violence, sexual assault, stalking, exploitation, fraud or serious harassment.</P>
          <P>We may request supporting information before taking action.</P>
        </Clause>

        <Clause n={15} title="User Content">
          <P>You retain ownership of content you submit.</P>
          <P>
            You grant MelloCrush a non-exclusive, worldwide, royalty-free licence to host, store, reproduce, display and technically process your content as
            reasonably necessary to operate, secure, moderate and improve the Service.
          </P>
          <P>This does not transfer ownership of your content to MelloCrush.</P>
          <P>You must have the necessary rights to content you upload.</P>
        </Clause>

        <Clause n={16} title="MelloCrush Plus">
          <P>MelloCrush may offer a paid membership called MelloCrush Plus.</P>
          <P>
            Benefits may include increased or unlimited usage of certain features, Likes You, additional discovery functionality, premium visibility features,
            Boost-related benefits or other benefits displayed at purchase.
          </P>
          <P>Current pricing, duration and benefits will be shown before payment.</P>
          <P>MelloCrush may change future plans, prices and benefits.</P>
          <P>Purchasing Plus does not guarantee likes, matches, replies, meetings, dates or relationships.</P>
        </Clause>

        <Clause n={17} title="Boost and Other Paid Features">
          <P>MelloCrush may offer Boost and other paid features.</P>
          <P>Boost may temporarily increase profile visibility or priority.</P>
          <P>It does not guarantee that another user will see, like or match with the boosted profile.</P>
        </Clause>

        <Clause n={18} title="Payments and Bank Transfers">
          <P>MelloCrush may accept bank transfer and other supported payment methods.</P>
          <P>For bank transfers, users may be required to upload a payment receipt.</P>
          <P>
            MelloCrush may use optical character recognition (OCR), automated checks and/or human review to verify transaction information such as the
            transaction reference, amount, receiving account and payment date.
          </P>
          <P>Receipts that appear altered, duplicated, fraudulent or inconsistent with the required payment may be rejected or referred for manual review.</P>
          <P>Payment fraud may result in account suspension or termination.</P>
        </Clause>

        <Clause n={19} title="Refunds and Consumer Rights">
          <P>
            Refund eligibility depends on the nature of the purchase, whether the purchased service has already been supplied and applicable law.
          </P>
          <P>Nothing in these Terms excludes or restricts consumer rights that cannot legally be excluded under applicable Maldivian law.</P>
          <P>
            For payment or Plus issues, contact <Mail address="support@mellocrush.com" />.
          </P>
        </Clause>

        <Clause n={20} title="Safety">
          <P>MelloCrush cannot guarantee the identity, intentions, honesty or behaviour of every user.</P>
          <P>MelloCrush does not guarantee that every user has undergone a comprehensive criminal background check.</P>
          <P>Users are responsible for exercising reasonable judgment when communicating with or meeting another person.</P>
          <P>
            Consider meeting in a public location, informing someone you trust, arranging your own transportation, protecting financial information and leaving
            any situation in which you feel unsafe.
          </P>
          <P>In an emergency, contact the appropriate authorities.</P>
        </Clause>

        <Clause n={21} title="Moderation">
          <P>MelloCrush may use automated systems and authorized human moderators to protect the Service and enforce these Terms and our Community Guidelines.</P>
          <P>Moderation may involve profile information, photographs, Community activity, reports, payment information and relevant communications.</P>
          <P>No moderation system is perfect. The presence of an account or content on MelloCrush does not constitute endorsement by MelloCrush.</P>
        </Clause>

        <Clause n={22} title="Suspension and Termination">
          <P>We may restrict, suspend or permanently terminate an account where we reasonably determine that:</P>
          <Bullets
            items={[
              "these Terms or Community Guidelines were materially violated;",
              "fraudulent activity occurred;",
              "an account belongs to a minor;",
              "an account creates a significant safety risk;",
              "another person’s rights were infringed;",
              "the Service is being manipulated;",
              "a ban is being circumvented; or",
              "action is required by applicable law.",
            ]}
          />
          <P>Serious violations may result in immediate termination.</P>
        </Clause>

        <Clause n={23} title="Appeals">
          <P>Where MelloCrush provides an appeal mechanism, users may request review of eligible moderation or account decisions.</P>
          <P>
            Contact <Mail address="support@mellocrush.com" /> for account-related appeals unless another appeal mechanism is provided within the Service.
          </P>
          <P>Submitting an appeal does not guarantee reinstatement.</P>
        </Clause>

        <Clause n={24} title="Account Deletion">
          <P>Users may delete their account through available account settings.</P>
          <P>Deleting a shortcut, closing a browser or signing out does not delete an account.</P>
          <P>After deletion, information will be handled according to our Privacy Policy and applicable retention requirements.</P>
          <P>
            For privacy or data-deletion questions, contact <Mail address="privacy@mellocrush.com" />.
          </P>
        </Clause>

        <Clause n={25} title="Intellectual Property">
          <P>
            The MelloCrush name, logo, visual identity, software, interfaces, graphics, designs and other MelloCrush-created materials belong to MelloCrush or
            its licensors.
          </P>
          <P>You may not reproduce, reverse engineer, sell or commercially exploit protected portions of the Service except where permitted by law.</P>
        </Clause>

        <Clause n={26} title="Service Availability">
          <P>MelloCrush may modify, suspend or discontinue features.</P>
          <P>We do not guarantee uninterrupted or error-free operation.</P>
          <P>Maintenance, security incidents, internet problems or third-party infrastructure may temporarily affect availability.</P>
        </Clause>

        <Clause n={27} title="No Guarantee of Results">
          <P>MelloCrush does not guarantee likes, matches, replies, compatibility, meetings, dates, friendships, romantic relationships or any particular outcome.</P>
        </Clause>

        <Clause n={28} title="Limitation of Liability">
          <P>
            To the maximum extent permitted by applicable law, MelloCrush is not responsible for losses caused solely by interactions between users that are
            outside MelloCrush’s reasonable control.
          </P>
          <P>Nothing in these Terms excludes liability or consumer rights that cannot lawfully be excluded.</P>
        </Clause>

        <Clause n={29} title="Legal Requests">
          <P>MelloCrush may preserve or disclose information where reasonably necessary to comply with applicable law, a valid court order or other lawful process.</P>
          <P>We may also preserve relevant information where reasonably necessary to investigate suspected fraud, abuse or serious safety incidents.</P>
        </Clause>

        <Clause n={30} title="Changes to These Terms">
          <P>We may update these Terms as MelloCrush, our features or applicable requirements change.</P>
          <P>The current version will display its latest revision date.</P>
          <P>Where changes materially affect users’ rights or obligations, we may provide additional notice where appropriate.</P>
        </Clause>

        <Clause n={31} title="Governing Law">
          <P>These Terms are governed by the laws of the Republic of Maldives, subject to mandatory legal rights that may apply.</P>
        </Clause>

        <Clause n={32} title="Contact">
          <P>MelloCrush</P>
          <ContactBlock
            lines={[
              { label: "Account, payment, Plus and technical support", address: "support@mellocrush.com" },
              { label: "Privacy and personal-data matters", address: "privacy@mellocrush.com" },
              { label: "Safety reports, harassment, threats, scams, suspected minors and serious misconduct", address: "safety@mellocrush.com" },
              { label: "General enquiries", address: "hello@mellocrush.com" },
            ]}
          />
        </Clause>
      </LegalDocument>
      <LegalFooter current="/terms" />
    </>
  );
}

import { Bullets, Clause, ContactBlock, LegalDocument, LegalFooter, Mail, P } from "@/components/features/legal/legal-document";

export const metadata = {
  title: "Privacy Policy",
  description: "What MelloCrush collects, how it is used, when it may be shared, how it is protected and the choices available to users.",
  alternates: { canonical: "/privacy" },
};

/**
 * Privacy Policy, supplied by the operator on 21 September 2026 and reproduced here verbatim
 * (docs/ARCHITECTURE.md §27). Nothing on this page is invented, and nothing describes processing the product does
 * not actually do — if the Service changes, this document is updated by the operator, not inferred from the code.
 */
export default function PrivacyPage() {
  return (
    <>
      <LegalDocument
        title="Privacy Policy"
        effective="21 September 2026"
        updated="21 September 2026"
        lead={
          <>
            <P>MelloCrush is built around personal connections, which makes privacy particularly important.</P>
            <P>
              This Privacy Policy explains what information MelloCrush collects, how we use it, when it may be shared, how it is protected and the choices
              available to users.
            </P>
          </>
        }
      >
        <Clause n={1} title="Who We Are">
          <P>MelloCrush operates the MelloCrush dating and social discovery service.</P>
          <P>Website: www.mellocrush.com</P>
          <P>
            Privacy enquiries: <Mail address="privacy@mellocrush.com" />
          </P>
        </Clause>

        <Clause n={2} title="Adults Only">
          <P>MelloCrush is available only to people aged 18 or older.</P>
          <P>We do not knowingly permit people under 18 to maintain accounts.</P>
          <P>If we reasonably determine that an account belongs to a person under 18, we may restrict or delete the account and associated information as appropriate.</P>
          <P>
            Suspected underage users can be reported through the Service or to <Mail address="safety@mellocrush.com" />.
          </P>
        </Clause>

        <Clause n={3} title="Information You Provide">
          <P>Information users provide may include:</P>
          <Bullets
            items={[
              "name or display name;",
              "email address;",
              "date of birth and age;",
              "gender;",
              "dating preferences;",
              "relationship preferences;",
              "island, atoll or general location;",
              "biography;",
              "interests;",
              "occupation;",
              "education;",
              "lifestyle information;",
              "photographs;",
              "verification information;",
              "Community content;",
              "reports;",
              "support communications; and",
              "other information voluntarily provided.",
            ]}
          />
          <P>Because MelloCrush is a dating service, information users choose to provide may reveal personal or sensitive aspects of their lives.</P>
          <P>Users should consider carefully what they choose to make visible.</P>
        </Clause>

        <Clause n={4} title="Authentication">
          <P>MelloCrush may support Google, Telegram and email/password authentication.</P>
          <P>
            When an external authentication provider is used, we may receive information authorized by the user and provider, such as an account identifier,
            name or email address.
          </P>
          <P>MelloCrush does not receive users’ Google or Telegram passwords.</P>
          <P>Email/password credentials are handled using appropriate security mechanisms. Passwords should never be stored as readable plaintext.</P>
        </Clause>

        <Clause n={5} title="Photos">
          <P>We process photographs to:</P>
          <Bullets
            items={[
              "display profiles;",
              "operate discovery;",
              "moderate content;",
              "investigate reports;",
              "prevent impersonation;",
              "support verification functionality; and",
              "protect platform safety.",
            ]}
          />
          <P>Photos may be reviewed using automated systems and/or authorized human moderation.</P>
        </Clause>

        <Clause n={6} title="Likes, Matches and Discovery">
          <P>
            We process information concerning profiles shown, likes, passes, matches, Likes You, discovery preferences, Boost activity, visibility and related
            interactions.
          </P>
          <P>This information is used to operate MelloCrush’s core dating functionality.</P>
        </Clause>

        <Clause n={7} title="Messages">
          <P>When users communicate through MelloCrush, we process information necessary to provide messaging.</P>
          <P>
            This may include message content, sender, recipient, timestamps, delivery information, read status where enabled and associated conversation
            information.
          </P>
          <P>Messages are not intended to be publicly visible.</P>
          <P>
            Relevant communications may be processed or reviewed where reasonably necessary to investigate reports, enforce our rules, protect users, prevent
            fraud or comply with legal obligations.
          </P>
        </Clause>

        <Clause n={8} title="Community">
          <P>When users participate in Community, we may process posts, comments, reactions, associated media, reports and moderation information.</P>
          <P>Community content may be visible to other MelloCrush users.</P>
        </Clause>

        <Clause n={9} title="Technical Information">
          <P>We may automatically process technical information such as:</P>
          <Bullets
            items={[
              "IP address;",
              "device type;",
              "browser;",
              "operating system;",
              "session identifiers;",
              "login timestamps;",
              "security events;",
              "error information; and",
              "diagnostic information.",
            ]}
          />
          <P>This information may be used to operate, secure and troubleshoot MelloCrush.</P>
        </Clause>

        <Clause n={10} title="Location Information">
          <P>MelloCrush may use general location information to provide locally relevant discovery.</P>
          <P>Depending on functionality, location information may come from:</P>
          <Bullets
            items={[
              "information selected or entered by the user;",
              "island or atoll information;",
              "approximate location derived from technical information; or",
              "device location if a feature requests location permission and the user grants it.",
            ]}
          />
          <P>MelloCrush will not represent that precise GPS location is collected unless such functionality is actually enabled.</P>
        </Clause>

        <Clause n={11} title="Payment Information">
          <P>If a user purchases MelloCrush Plus or another paid feature, we process information required to administer and verify the transaction.</P>
          <P>For bank transfers this may include:</P>
          <Bullets
            items={[
              "uploaded receipt;",
              "bank information;",
              "transaction reference;",
              "amount;",
              "date;",
              "payer information visible on the receipt; and",
              "receiving account information.",
            ]}
          />
        </Clause>

        <Clause n={12} title="Receipt OCR">
          <P>Uploaded payment receipts may be processed using optical character recognition (OCR).</P>
          <P>OCR may extract information such as transaction ID, amount, payment date and relevant bank information.</P>
          <P>Extracted information may be compared against expected payment details.</P>
          <P>Automated processing may result in approval, rejection or manual-review states.</P>
          <P>MelloCrush may use transaction information and cryptographic identifiers to detect duplicate submissions and suspected payment fraud.</P>
        </Clause>

        <Clause n={13} title="How We Use Information">
          <P>We may use information to:</P>
          <Bullets
            items={[
              "create and maintain accounts;",
              "authenticate users;",
              "verify email addresses;",
              "operate profiles;",
              "provide discovery;",
              "process likes and matches;",
              "deliver messages;",
              "provide Community;",
              "deliver notifications;",
              "provide Plus and Boost;",
              "process and verify payments;",
              "moderate photos and content;",
              "investigate reports;",
              "detect scams and fake accounts;",
              "prevent abuse;",
              "enforce restrictions and bans;",
              "maintain security;",
              "provide support;",
              "diagnose technical problems;",
              "improve MelloCrush;",
              "enforce our Terms and Community Guidelines; and",
              "comply with applicable legal obligations.",
            ]}
          />
        </Clause>

        <Clause n={14} title="Information Visible to Other Users">
          <P>Depending on features and settings, other users may see information including:</P>
          <Bullets
            items={[
              "profile name;",
              "age;",
              "profile photos;",
              "biography;",
              "interests;",
              "general location;",
              "occupation or education;",
              "selected preferences;",
              "verification status;",
              "Community activity; and",
              "other information intentionally made visible.",
            ]}
          />
          <P>Passwords, authentication credentials and payment receipts are not intended to be publicly displayed.</P>
        </Clause>

        <Clause n={15} title="Information Shared With Other Users">
          <P>Information sent to another user may be copied, screenshotted, photographed or otherwise retained by that person.</P>
          <P>MelloCrush cannot technically prevent every user from independently recording information displayed on their device.</P>
          <P>Users should avoid sharing passwords, banking credentials, identification documents or other highly sensitive information through dating conversations.</P>
        </Clause>

        <Clause n={16} title="Moderation and Safety">
          <P>
            We may process relevant information to investigate reports, detect scams, identify spam, detect impersonation, moderate content, investigate
            threats, enforce restrictions, prevent ban evasion and protect users.
          </P>
          <P>This may involve automated systems and authorized human review.</P>
        </Clause>

        <Clause n={17} title="Reports">
          <P>
            When a report is submitted, we may process information concerning the reporting account, reported account, reason for the report, relevant content
            or communications, supporting information and resulting moderation actions.
          </P>
          <P>We do not normally disclose the reporting user’s identity to the reported user unless required by applicable law.</P>
        </Clause>

        <Clause n={18} title="Service Providers">
          <P>
            MelloCrush may use third-party providers for functions including cloud hosting, databases, authentication, email delivery, analytics, security,
            content processing and other technical infrastructure.
          </P>
          <P>These providers may process information where necessary to provide their services to MelloCrush.</P>
        </Clause>

        <Clause n={19} title="International Processing">
          <P>Some technology providers used by MelloCrush may operate infrastructure outside the Maldives.</P>
          <P>Information may therefore be processed or stored in other countries.</P>
          <P>
            MelloCrush will take reasonable measures appropriate to the information and services involved to protect personal information handled through its
            providers.
          </P>
        </Clause>

        <Clause n={20} title="Sale of Private Dating Data">
          <P>MelloCrush does not sell users’ private messages or private dating-profile information as a standalone product to third parties.</P>
          <P>
            If MelloCrush materially changes its commercial use of personal information in the future, this Privacy Policy must be updated accordingly before
            such processing where required.
          </P>
        </Clause>

        <Clause n={21} title="Security">
          <P>MelloCrush uses reasonable technical and organizational safeguards designed to protect information.</P>
          <P>
            These may include encrypted network connections, authentication controls, password hashing, access controls, administrative permissions, security
            logging, rate limiting, fraud detection and moderation controls.
          </P>
          <P>No internet service can guarantee absolute security.</P>
        </Clause>

        <Clause n={22} title="Data Retention">
          <P>We retain information for as long as reasonably necessary for the purpose for which it was collected.</P>
          <P>After account deletion, information should be deleted or anonymized when it is no longer reasonably required.</P>
          <P>Certain information may be retained where reasonably necessary for:</P>
          <Bullets
            items={[
              "fraud prevention;",
              "preventing serious offenders from immediately returning;",
              "safety investigations;",
              "dispute resolution;",
              "accounting and payment records;",
              "enforcement of agreements; or",
              "compliance with applicable legal requirements.",
            ]}
          />
          <P>Backup systems may temporarily retain information after deletion.</P>
        </Clause>

        <Clause n={23} title="Banned Accounts">
          <P>
            For accounts permanently banned for serious misconduct, MelloCrush may retain limited information reasonably necessary to identify and prevent ban
            evasion, subject to applicable law.
          </P>
          <P>This does not mean that a complete user profile must be retained indefinitely.</P>
        </Clause>

        <Clause n={24} title="Your Privacy Choices">
          <P>Depending on available functionality, users may be able to:</P>
          <Bullets
            items={[
              "edit profile information;",
              "remove photos;",
              "manage privacy settings;",
              "control notifications;",
              "manage discovery visibility;",
              "block users;",
              "delete Community content; and",
              "delete their account.",
            ]}
          />
          <P>
            For questions or requests concerning personal information, contact <Mail address="privacy@mellocrush.com" />.
          </P>
        </Clause>

        <Clause n={25} title="Account and Data Deletion">
          <P>Users may delete their MelloCrush account through account settings where available.</P>
          <P>After deletion, the profile should cease appearing through normal discovery and remaining information will be handled according to applicable retention requirements.</P>
          <P>Signing out or deleting a shortcut does not delete an account.</P>
          <P>
            For privacy or data-deletion assistance, contact <Mail address="privacy@mellocrush.com" />.
          </P>
        </Clause>

        <Clause n={26} title="Cookies and Similar Technologies">
          <P>
            MelloCrush may use cookies, local storage and similar technologies for authentication, sessions, security, preferences, fraud prevention, analytics
            and performance.
          </P>
          <P>Where legally required, additional controls may be provided for non-essential technologies.</P>
        </Clause>

        <Clause n={27} title="Notifications and Email">
          <P>
            MelloCrush may send communications relating to verification, matches, likes, messages, security, account changes, payments, Community activity and
            service updates.
          </P>
          <P>Optional marketing communications should provide an appropriate unsubscribe mechanism.</P>
          <P>Essential account, transactional and security communications may still be sent where necessary.</P>
        </Clause>

        <Clause n={28} title="Automated Systems">
          <P>
            MelloCrush may use automated processing for discovery, recommendations, moderation assistance, spam detection, fraud detection, receipt OCR,
            duplicate-payment detection, security and rate limiting.
          </P>
          <P>Automated recommendations do not represent a determination or guarantee that two users are compatible.</P>
        </Clause>

        <Clause n={29} title="Legal and Safety Disclosures">
          <P>
            MelloCrush may preserve or disclose information where reasonably necessary to comply with applicable law, valid legal process or a lawful request
            from an authorized authority.
          </P>
          <P>
            Information may also be preserved or disclosed where reasonably necessary to investigate fraud or serious abuse, protect someone’s safety,
            establish or defend legal claims or enforce our Terms.
          </P>
          <P>MelloCrush does not provide unrestricted access to user information merely because someone requests it.</P>
        </Clause>

        <Clause n={30} title="Changes to This Privacy Policy">
          <P>We may update this Privacy Policy as MelloCrush develops or applicable requirements change.</P>
          <P>The current version will display its latest revision date.</P>
          <P>Where changes materially affect how personal information is handled, additional notice may be provided where appropriate.</P>
        </Clause>

        <Clause n={31} title="Applicable Law">
          <P>MelloCrush operates from the Maldives.</P>
          <P>This Privacy Policy is intended to operate consistently with applicable laws of the Republic of Maldives.</P>
          <P>Nothing in this Policy removes mandatory legal rights available to users.</P>
        </Clause>

        <Clause n={32} title="Contact Us">
          <ContactBlock
            lines={[
              { label: "Privacy, personal-data and deletion requests", address: "privacy@mellocrush.com" },
              { label: "Safety concerns involving another user", address: "safety@mellocrush.com" },
              { label: "Account, payment and technical support", address: "support@mellocrush.com" },
              { label: "General enquiries", address: "hello@mellocrush.com" },
            ]}
          />
        </Clause>
      </LegalDocument>
      <LegalFooter current="/privacy" />
    </>
  );
}

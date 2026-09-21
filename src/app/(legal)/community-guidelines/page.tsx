import { Bullets, Clause, ContactBlock, LegalDocument, LegalFooter, Mail, P } from "@/components/features/legal/legal-document";

export const metadata = {
  title: "Community Guidelines",
  description: "How to behave on MelloCrush: the rules that apply to profiles, chats, Community and meeting people.",
  alternates: { canonical: "/community-guidelines" },
};

/**
 * Community Guidelines, supplied by the operator on 21 September 2026 and reproduced here verbatim
 * (docs/ARCHITECTURE.md §27). This is the document the reporting and safety surfaces link to, so it is the one
 * users are pointed at when something has gone wrong — the wording is the operator’s and is not paraphrased.
 */
export default function CommunityGuidelinesPage() {
  return (
    <>
      <LegalDocument
        title="Community Guidelines"
        effective="21 September 2026"
        updated="21 September 2026"
        lead={
          <>
            <P>MelloCrush is for real people making real connections.</P>
            <P>Whether you’re swiping, matching, chatting or participating in Community, treat the person on the other side of the screen with respect.</P>
            <P>These Guidelines apply across MelloCrush.</P>
            <P>Serious or repeated violations may result in content removal, restrictions, suspension or a permanent ban.</P>
          </>
        }
      >
        <Clause n={1} title="You Must Be 18+">
          <P>MelloCrush is strictly for adults aged 18 or older.</P>
          <P>Do not:</P>
          <Bullets
            items={[
              "create an account if you’re under 18;",
              "lie about your age to access MelloCrush;",
              "create an account for a minor; or",
              "use MelloCrush to seek sexual or romantic interaction with minors.",
            ]}
          />
          <P>Suspected underage accounts may be suspended while reviewed.</P>
          <P>Accounts confirmed to belong to minors will be removed.</P>
          <P>
            Report suspected underage users through MelloCrush or to <Mail address="safety@mellocrush.com" />.
          </P>
        </Clause>

        <Clause n={2} title="Be Yourself">
          <P>Your profile should represent the real you.</P>
          <P>Don’t:</P>
          <Bullets
            items={[
              "pretend to be someone else;",
              "use another person’s photos as your own;",
              "catfish people;",
              "create deceptive personas;",
              "deliberately lie about your age; or",
              "impersonate another person.",
            ]}
          />
          <P>
            You don’t have to disclose everything about yourself, but information you provide must not intentionally deceive people about who they are
            interacting with.
          </P>
        </Clause>

        <Clause n={3} title="Use Appropriate Photos">
          <P>Don’t upload:</P>
          <Bullets
            items={[
              "stolen photographs;",
              "photographs falsely presented as you;",
              "private images of someone without permission;",
              "prohibited explicit sexual images;",
              "pornography;",
              "exploitative content; or",
              "unlawful content.",
            ]}
          />
          <P>Photos may require moderation approval before appearing to other users.</P>
        </Clause>

        <Clause n={4} title="Respect Consent">
          <P>A match is not consent.</P>
          <P>A like is not consent.</P>
          <P>A conversation is not consent.</P>
          <P>Agreeing to meet is not consent to anything else.</P>
          <P>If someone asks you to stop, stop.</P>
          <P>If someone blocks or unmatches you, respect that boundary.</P>
          <P>Do not create another account or use other means to continue unwanted contact.</P>
        </Clause>

        <Clause n={5} title="No Sexual Harassment">
          <P>Flirting is part of dating. Sexual harassment isn’t.</P>
          <P>Don’t:</P>
          <Bullets
            items={[
              "send unwanted sexual messages;",
              "repeatedly pressure someone for sexual conversations;",
              "send unsolicited explicit images;",
              "pressure someone for intimate photographs;",
              "make sexual threats;",
              "blackmail someone using intimate material; or",
              "continue sexual conversations after someone asks you to stop.",
            ]}
          />
        </Clause>

        <Clause n={6} title="No Public Explicit Content">
          <P>Profiles and Community are not places for pornographic or explicit sexual content.</P>
          <P>
            Do not post prohibited nudity, pornography, explicit sexual acts, sexual solicitation or other content prohibited by MelloCrush’s moderation rules.
          </P>
        </Clause>

        <Clause n={7} title="No Prostitution or Paid Sexual Services">
          <P>MelloCrush is for dating and social connections.</P>
          <P>It is not a marketplace for sexual services.</P>
          <P>Do not use MelloCrush to:</P>
          <Bullets
            items={[
              "sell sexual services;",
              "purchase sexual services;",
              "advertise escort services;",
              "solicit prostitution;",
              "arrange paid sexual encounters;",
              "recruit people for sexual exploitation; or",
              "facilitate human trafficking.",
            ]}
          />
          <P>
            Serious violations may result in immediate permanent removal and may be reported to appropriate authorities where legally required or necessary to
            address serious harm.
          </P>
        </Clause>

        <Clause n={8} title="No Scams">
          <P>Never use MelloCrush to manipulate someone into giving you money.</P>
          <P>
            Prohibited behaviour includes romance scams, fake emergencies, fraudulent investments, cryptocurrency scams, phishing, fraudulent fundraising and
            manipulation intended to obtain money or financial information.
          </P>
          <P>Be extremely cautious if someone you meet online asks for money.</P>
        </Clause>

        <Clause n={9} title="No Harassment">
          <P>Do not bully, intimidate, repeatedly insult, stalk, threaten, blackmail, shame or repeatedly contact someone who does not want contact.</P>
          <P>Do not encourage other people to harass another user.</P>
          <P>Disagreement is allowed. Harassment isn’t.</P>
        </Clause>

        <Clause n={10} title="No Hate or Dehumanizing Abuse">
          <P>Do not attack, threaten or dehumanize people based on protected characteristics under applicable law.</P>
          <P>Dating preferences do not give anyone permission to humiliate or abuse other people.</P>
        </Clause>

        <Clause n={11} title="No Threats or Violence">
          <P>
            MelloCrush does not allow credible threats, encouragement of violence, graphic violent content intended to shock, threats against users or
            promotion of serious violent criminal activity.
          </P>
          <P>
            Where MelloCrush reasonably believes someone faces an imminent serious threat, appropriate safety measures may be taken and relevant authorities
            may be contacted where permitted or required by law.
          </P>
        </Clause>

        <Clause n={12} title="Keep Private Things Private">
          <P>Do not publish another person’s private information without permission.</P>
          <P>This can include:</P>
          <Bullets
            items={[
              "phone numbers;",
              "home addresses;",
              "private email addresses;",
              "identification documents;",
              "financial information;",
              "private photographs;",
              "intimate images;",
              "private messages; or",
              "other information reasonably understood to be private.",
            ]}
          />
          <P>This rule continues to apply after an argument, unmatch or breakup.</P>
        </Clause>

        <Clause n={13} title="No Intimate-Image Abuse">
          <P>Never share, distribute or threaten to distribute someone’s intimate content without their consent.</P>
          <P>Permission to receive intimate content does not mean permission to publish or redistribute it.</P>
        </Clause>

        <Clause n={14} title="No Stalking">
          <P>Do not use information obtained through MelloCrush to track, monitor or repeatedly approach someone against their wishes.</P>
          <P>If someone blocks or unmatches you, respect that boundary.</P>
          <P>Do not attempt to bypass it using another account or other abusive means.</P>
        </Clause>

        <Clause n={15} title="Community Is Not a Call-Out Board">
          <P>Do not use Community to publicly expose, shame or organize attacks against another MelloCrush user.</P>
          <P>If another user violates the rules, report them privately.</P>
          <P>Do not publish screenshots of private conversations to embarrass or harass another person.</P>
        </Clause>

        <Clause n={16} title="No Spam">
          <P>Don’t spam users with repeated messages, unsolicited advertisements, referral links, mass promotions, suspicious links or repetitive content.</P>
        </Clause>

        <Clause n={17} title="Dating, Not Advertising">
          <P>MelloCrush profiles should primarily be used for genuine personal connections.</P>
          <P>
            Don’t create accounts primarily to advertise businesses, gain followers, promote products, recruit customers, promote investment schemes or conduct
            mass marketing.
          </P>
        </Clause>

        <Clause n={18} title="Don’t Evade Enforcement">
          <P>Do not create additional accounts to:</P>
          <Bullets
            items={[
              "contact someone who blocked you;",
              "evade moderation;",
              "continue harassment;",
              "manipulate platform activity; or",
              "circumvent a suspension or permanent ban.",
            ]}
          />
          <P>Additional accounts may also be removed.</P>
        </Clause>

        <Clause n={19} title="Don’t Manipulate MelloCrush">
          <P>Do not:</P>
          <Bullets
            items={[
              "scrape profiles;",
              "operate unauthorized bots;",
              "automate swiping;",
              "automate messaging;",
              "exploit security vulnerabilities;",
              "attempt unauthorized access;",
              "interfere with security controls;",
              "manipulate payment systems; or",
              "bypass Plus restrictions.",
            ]}
          />
          <P>Security vulnerabilities should be responsibly reported rather than exploited.</P>
        </Clause>

        <Clause n={20} title="Respect Other People’s Content">
          <P>Do not publish photographs, text or other content you do not have permission to use.</P>
          <P>Do not publicly share another user’s private messages or private photographs without permission.</P>
        </Clause>

        <Clause n={21} title="Meet Safely">
          <P>When meeting someone from MelloCrush for the first time:</P>
          <Bullets
            items={[
              "consider meeting somewhere public;",
              "tell someone you trust;",
              "arrange your own transportation;",
              "keep control of your phone and belongings;",
              "protect your financial information; and",
              "leave if you feel unsafe.",
            ]}
          />
          <P>You are never obligated to continue a date or interaction simply because you previously matched or chatted.</P>
        </Clause>

        <Clause n={22} title="Be Careful With Money">
          <P>Be cautious if someone asks for:</P>
          <Bullets
            items={[
              "money;",
              "cryptocurrency;",
              "investments;",
              "bank transfers;",
              "gift cards;",
              "banking credentials; or",
              "financial assistance.",
            ]}
          />
          <P>If something appears suspicious, stop communicating and report the account.</P>
        </Clause>

        <Clause n={23} title="Reporting">
          <P>Report violations using MelloCrush’s reporting tools whenever possible.</P>
          <P>Reports may concern:</P>
          <Bullets
            items={[
              "fake profiles;",
              "suspected minors;",
              "harassment;",
              "prohibited explicit content;",
              "scams;",
              "threats;",
              "stalking;",
              "impersonation;",
              "commercial sexual solicitation;",
              "inappropriate Community content; or",
              "other safety concerns.",
            ]}
          />
          <P>
            For serious safety concerns, contact <Mail address="safety@mellocrush.com" />.
          </P>
          <P>Reports must be made honestly. Deliberately submitting malicious false reports may itself violate these Guidelines.</P>
        </Clause>

        <Clause n={24} title="Blocking">
          <P>Blocking is a boundary.</P>
          <P>A blocked user must not attempt to circumvent the block through another MelloCrush account or other abusive means.</P>
        </Clause>

        <Clause n={25} title="What Happens After a Report?">
          <P>A report does not automatically establish that someone violated our rules.</P>
          <P>MelloCrush may review relevant information and determine the appropriate response.</P>
          <P>Depending on the circumstances, MelloCrush may:</P>
          <Bullets
            items={[
              "take no action;",
              "remove content;",
              "reject a photo;",
              "issue a warning;",
              "restrict an account;",
              "require additional verification;",
              "temporarily suspend an account; or",
              "permanently ban an account.",
            ]}
          />
          <P>Serious violations may result in immediate action.</P>
        </Clause>

        <Clause n={26} title="Serious Behaviour Outside MelloCrush">
          <P>
            Credible reports of serious harmful behaviour involving people who connected through MelloCrush may affect an account even when an incident occurs
            outside the platform.
          </P>
          <P>This may include sexual assault, physical violence, stalking, serious threats, fraud, exploitation or serious harassment.</P>
          <P>MelloCrush may request supporting information before making an enforcement decision.</P>
        </Clause>

        <Clause n={27} title="Appeals">
          <P>
            If you believe an enforcement decision was made in error, use the available appeal mechanism or contact <Mail address="support@mellocrush.com" />.
          </P>
          <P>Explain why you believe the decision should be reviewed.</P>
          <P>An appeal does not guarantee reinstatement.</P>
        </Clause>

        <Clause n={28} title="Remember the Person">
          <P>Behind every MelloCrush profile is a real person.</P>
          <P>You don’t have to like everyone.</P>
          <P>You don’t have to match with everyone.</P>
          <P>You don’t have to reply to everyone.</P>
          <P>But everyone should be treated with basic respect.</P>
          <P className="text-text">Swipe respectfully. Chat responsibly. Meet safely.</P>
        </Clause>

        <section aria-labelledby="contact-mellocrush" className="flex flex-col gap-3">
          <h2 id="contact-mellocrush" className="text-h3 text-text">
            Contact MelloCrush
          </h2>
          <ContactBlock
            lines={[
              { label: "Safety reports", address: "safety@mellocrush.com" },
              { label: "Privacy", address: "privacy@mellocrush.com" },
              { label: "Account & technical support", address: "support@mellocrush.com" },
              { label: "General enquiries", address: "hello@mellocrush.com" },
            ]}
          />
        </section>
      </LegalDocument>
      <LegalFooter current="/community-guidelines" />
    </>
  );
}

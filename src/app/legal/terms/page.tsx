export const metadata = { title: "Terms of Service" };

/**
 * Placeholder until the owner supplies the final Terms of Service (docs/ARCHITECTURE.md §20). States only what the
 * product already enforces; nothing here invents legal terms.
 */
export default function TermsPage() {
  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-h1">Terms of Service</h1>
      <p className="text-body text-text-secondary">The full Terms of Service are being finalised and will be published here before Mellocrush opens to the public.</p>
      <p className="text-body text-text-secondary">What already applies: Mellocrush is for people aged 18 and over, one account per person, and behaviour that harms others (harassment, impersonation, unwanted contact) leads to removal. Reports and blocks are kept so they stay effective.</p>
    </article>
  );
}

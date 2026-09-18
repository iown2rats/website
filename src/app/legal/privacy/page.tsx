export const metadata = { title: "Privacy Policy" };

/**
 * Placeholder until the owner supplies the final Privacy Policy (docs/ARCHITECTURE.md §20). Describes only what the
 * product already does with data; nothing here invents commitments.
 */
export default function PrivacyPage() {
  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-h1">Privacy Policy</h1>
      <p className="text-body text-text-secondary">The full Privacy Policy is being finalised and will be published here before Mellocrush opens to the public.</p>
      <p className="text-body text-text-secondary">What already applies: you sign in with Google or Telegram and Mellocrush stores only the identifier that provider gives it; your photos are private objects served through short-lived links; your date of birth is used only to show your age; a phone number is optional and, if you add one, is used only for contact blocking, hashed on your device. Deleting your account removes your profile, photos, likes and posts immediately.</p>
    </article>
  );
}

import { AuthDivider, AuthHeading, AuthLegalLine, AuthTagline } from "@/components/features/auth/auth-shell";
import { EmailAuthForm } from "@/components/features/auth/email-auth-form";
import { ContinueWithGoogle, ContinueWithTelegram } from "@/components/features/auth/google-button";

/**
 * The contents of the welcome card: wordmark, tagline, every way in, and the legal line (DESIGN_SYSTEM §26/§27).
 *
 * Extracted from the page so the admin cover preview can render the REAL controls over a candidate background rather
 * than a drawing of it. If this changes, the preview changes with it, which is the point — a preview that has its
 * own copy of the card is a preview that quietly stops being true.
 *
 * Each method appears only when it can actually complete: Telegram needs its client and the TELEGRAM enum value,
 * email needs a working mail provider and the AuthToken table. A half-configured deployment shows fewer buttons
 * rather than a broken form.
 */
export function WelcomeCard({ telegram, emailAuth }: { telegram: boolean; emailAuth: boolean }) {
  return (
    <>
      <AuthHeading id="welcome-title" />
      <AuthTagline />
      {/* The provider buttons share the fields' width and pill but almost none of their depth: barely raised against
          a screen where Email and Password are pressed in and the coral primary stands off it (DESIGN_SYSTEM §37).
          The four-colour G is the only brand colour besides the coral. */}
      <div className="mt-5 flex w-full flex-col gap-2.5">
        <ContinueWithGoogle shape="pill" appearance="glass" textClass="text-cta-lg" heightClass="h-12" markSize={18} />
        {telegram ? <ContinueWithTelegram shape="pill" appearance="glass" textClass="text-cta-lg" heightClass="h-12" markSize={18} /> : null}
      </div>
      {emailAuth ? (
        <>
          <AuthDivider />
          <EmailAuthForm />
        </>
      ) : null}
      <AuthLegalLine />
    </>
  );
}

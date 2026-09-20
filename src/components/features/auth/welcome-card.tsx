import { AuthDivider, AuthHeading, AuthLegalLine, AuthTagline } from "@/components/features/auth/auth-shell";
import { EmailAuthForm } from "@/components/features/auth/email-auth-form";
import { ContinueWithGoogle, ContinueWithTelegram } from "@/components/features/auth/google-button";

/**
 * The contents of the welcome card: wordmark, tagline, every way in, and the legal line (DESIGN_SYSTEM §26/§27).
 *
 * Extracted from the page so the admin cover preview can render the REAL card over a candidate background rather
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
      {/* One surface for every control on the card: the provider buttons use the same translucent glass as the email
          fields below them, so nothing shouts. The four-colour G is the only brand colour left (DESIGN_SYSTEM §27). */}
      <div className="mt-4.5 flex w-full flex-col gap-2">
        <ContinueWithGoogle shape="pill" appearance="glass" textClass="text-cta-lg" heightClass="h-11" markSize={18} />
        {telegram ? <ContinueWithTelegram shape="pill" appearance="glass" textClass="text-cta-lg" heightClass="h-11" markSize={18} /> : null}
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

import { redirect } from "next/navigation";
import { AuthDivider, AuthHeading, AuthLegalLine, AuthShell, AuthTagline } from "@/components/features/auth/auth-shell";
import { EmailAuthForm } from "@/components/features/auth/email-auth-form";
import { ContinueWithGoogle, ContinueWithTelegram } from "@/components/features/auth/google-button";
import { getDb } from "@/lib/db";
import { getAuthState } from "@/server/auth/current-user";
import { emailAuthAvailable } from "@/server/auth/email-availability";
import { ROUTES } from "@/server/auth/route-access";
import { telegramSignInAvailable } from "@/server/auth/telegram-availability";

/*
 * Mellocrush welcome screen: one full-screen photograph (a Maldivian beach at night under the Milky Way, a couple on
 * the sand) and one centred frosted-glass card holding every way in — Continue with Google, Continue with Telegram,
 * an "or" rule, then email and password with Create account and Forgot password (DESIGN_SYSTEM §26/§27).
 *
 * Each method appears only when it can actually complete: Telegram needs its client and the TELEGRAM enum value,
 * email needs a working mail provider and the AuthToken table. A half-configured deployment shows fewer buttons
 * rather than a broken form.
 */
export default async function WelcomePage() {
  const state = await getAuthState();
  if (state.kind === "active") redirect(ROUTES.home);
  if (state.kind === "unverified") redirect(ROUTES.verifyEmail);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
  const db = getDb();
  const [telegram, emailAuth] = await Promise.all([telegramSignInAvailable(db), emailAuthAvailable(db)]);

  return (
    <AuthShell labelledBy="welcome-title" priority>
      <AuthHeading id="welcome-title" />
      <AuthTagline />
      {/* One surface for every control on the card: the provider buttons use the same translucent glass as the email
          fields below them, so nothing shouts. The four-colour G is the only brand colour left (DESIGN_SYSTEM §27). */}
      <div className="mt-6 flex w-full flex-col gap-2.5">
        <ContinueWithGoogle shape="pill" appearance="glass" textClass="text-[15px] font-semibold" heightClass="h-12" markSize={20} />
        {telegram ? <ContinueWithTelegram shape="pill" appearance="glass" textClass="text-[15px] font-semibold" heightClass="h-12" markSize={20} /> : null}
      </div>
      {emailAuth ? (
        <>
          <AuthDivider />
          <EmailAuthForm />
        </>
      ) : null}
      <AuthLegalLine />
    </AuthShell>
  );
}

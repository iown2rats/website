import { redirect } from "next/navigation";
import { AuthShell } from "@/components/features/auth/auth-shell";
import { WelcomeCard } from "@/components/features/auth/welcome-card";
import { getDb } from "@/lib/db";
import { getAuthState } from "@/server/auth/current-user";
import { emailAuthAvailable } from "@/server/auth/email-availability";
import { ROUTES } from "@/server/auth/route-access";
import { telegramSignInAvailable } from "@/server/auth/telegram-availability";
import { currentWelcomeCover } from "@/server/welcome/active-cover";

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
  // An operational account never sees the dating welcome screen; it goes to the portal (§13, §22.1). This is the
  // one member route with no shared layout guard above it, so the check has to be here.
  if (state.kind === "staff") redirect(ROUTES.staffHome);
  if (state.kind === "active") redirect(ROUTES.home);
  if (state.kind === "unverified") redirect(ROUTES.verifyEmail);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
  const db = getDb();
  // The cover joins the pair this page already awaits, so making the background dynamic costs no extra round trip.
  const [telegram, emailAuth, cover] = await Promise.all([telegramSignInAvailable(db), emailAuthAvailable(db), currentWelcomeCover()]);

  return (
    <AuthShell cover={cover} labelledBy="welcome-title" priority>
      <WelcomeCard telegram={telegram} emailAuth={emailAuth} />
    </AuthShell>
  );
}

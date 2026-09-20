import { redirect } from "next/navigation";
import { AuthBackLink, AuthHeading, AuthShell } from "@/components/features/auth/auth-shell";
import { EmailAuthForm } from "@/components/features/auth/email-auth-form";
import { getDb } from "@/lib/db";
import { redirectIfAuthenticated } from "@/server/auth/current-user";
import { emailAuthAvailable } from "@/server/auth/email-availability";
import { ROUTES } from "@/server/auth/route-access";
import { currentWelcomeCover } from "@/server/welcome/active-cover";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

/**
 * A direct link to creating an account (docs/ARCHITECTURE.md §4.1b): the same card the welcome screen shows, opened
 * straight into register mode. The usual way in is the welcome card's own "Create account", which switches in place.
 * Hidden entirely when the method is not ready.
 */
export default async function RegisterPage() {
  await redirectIfAuthenticated();
  if (!(await emailAuthAvailable(getDb()))) redirect(ROUTES.welcome);
  const cover = await currentWelcomeCover();
  return (
    <AuthShell cover={cover} labelledBy="register-title" below={<AuthBackLink>Back to sign in</AuthBackLink>}>
      <AuthHeading id="register-title" compact title="Create your account" subtitle="Use an email address and a password. You'll confirm the address next." />
      <EmailAuthForm initialMode="register" />
    </AuthShell>
  );
}

import { redirect } from "next/navigation";
import { AuthBackLink, AuthHeading, AuthShell } from "@/components/features/auth/auth-shell";
import { RegisterForm } from "@/components/features/auth/register-form";
import { getDb } from "@/lib/db";
import { redirectIfAuthenticated } from "@/server/auth/current-user";
import { emailAuthAvailable } from "@/server/auth/email-availability";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

/** Create an account with an email address (docs/ARCHITECTURE.md §4.1b). Hidden entirely when the method is not ready. */
export default async function RegisterPage() {
  await redirectIfAuthenticated();
  if (!(await emailAuthAvailable(getDb()))) redirect(ROUTES.welcome);
  return (
    <AuthShell labelledBy="register-title" below={<AuthBackLink>Back to sign in</AuthBackLink>}>
      <AuthHeading id="register-title" compact title="Create your account" subtitle="Use an email address and a password. You'll confirm the address next." />
      <RegisterForm />
    </AuthShell>
  );
}

import { redirect } from "next/navigation";
import { AuthBackLink, AuthHeading, AuthShell } from "@/components/features/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/features/auth/forgot-password-form";
import { getDb } from "@/lib/db";
import { redirectIfAuthenticated } from "@/server/auth/current-user";
import { emailAuthAvailable } from "@/server/auth/email-availability";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  await redirectIfAuthenticated();
  if (!(await emailAuthAvailable(getDb()))) redirect(ROUTES.welcome);
  return (
    <AuthShell labelledBy="forgot-title" below={<AuthBackLink>Back to sign in</AuthBackLink>}>
      <AuthHeading id="forgot-title" compact title="Reset your password" subtitle="Enter the address you signed up with and we'll send a link." />
      <ForgotPasswordForm />
    </AuthShell>
  );
}

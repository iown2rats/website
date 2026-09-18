import { redirect } from "next/navigation";
import { AuthBackLink, AuthHeading, AuthShell } from "@/components/features/auth/auth-shell";
import { ResetPasswordForm } from "@/components/features/auth/reset-password-form";
import { getDb } from "@/lib/db";
import { emailAuthAvailable } from "@/server/auth/email-availability";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Set a new password" };
export const dynamic = "force-dynamic";

/**
 * The page a reset link opens. The token is never checked here — it is carried into the server action and consumed
 * there — so a visitor cannot learn anything from the page itself beyond the form (docs/ARCHITECTURE.md §4.1b).
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (!(await emailAuthAvailable(getDb()))) redirect(ROUTES.welcome);
  const { token } = await searchParams;
  if (!token) {
    return (
      <AuthShell labelledBy="reset-title" below={<AuthBackLink>Back to sign in</AuthBackLink>}>
        <AuthHeading id="reset-title" compact title="That link is incomplete" subtitle="Open the link from your email again, or ask for a new one." />
      </AuthShell>
    );
  }
  return (
    <AuthShell labelledBy="reset-title" below={<AuthBackLink>Back to sign in</AuthBackLink>}>
      <AuthHeading id="reset-title" compact title="Set a new password" subtitle="Choose a password you don't use anywhere else." />
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}

import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/features/auth/auth-shell";
import { VerifyEmailClient } from "@/components/features/auth/verify-email-client";
import { getDb } from "@/lib/db";
import { getAuthState } from "@/server/auth/current-user";
import { getEmailVerificationState } from "@/server/auth/email-identity";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Verify your email" };
export const dynamic = "force-dynamic";

/**
 * The screen an unconfirmed email account is sent to from everywhere else (docs/ARCHITECTURE.md §4.1b). Reachable
 * only in that state: anyone else is routed where they belong, so it never shows an address to the wrong person.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect(ROUTES.welcome);
  if (state.kind === "active") redirect(ROUTES.home);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
  const verification = await getEmailVerificationState(getDb(), state.user.id);
  if (!verification) redirect(ROUTES.onboarding);
  const { expired } = await searchParams;
  return (
    <AuthShell labelledBy="verify-title">
      <AuthHeading id="verify-title" compact title="Verify your email" />
      <VerifyEmailClient email={verification.email} expired={expired === "1"} />
    </AuthShell>
  );
}

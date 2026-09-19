import { StaffPortalShell } from "@/components/features/staff/portal-shell";
import { StaffSetPasswordForm } from "@/components/features/staff/portal-forms";
import { Callout } from "@/components/ui/alert";
import { getDb } from "@/lib/db";
import { describeInvite } from "@/server/staff/claim";

export const metadata = { title: "Set up your admin account · Mellocrush" };
export const dynamic = "force-dynamic";

/**
 * Claiming a staff invitation, and the same screen for an administrator setting their first portal password
 * (docs/ARCHITECTURE.md §22.2).
 *
 * The token is only *peeked* at here, never consumed: rendering the page shows whose invitation it is so the
 * visitor knows what they are accepting, and the server action that saves the password is what spends the link.
 * An unusable link — wrong, expired, already used, or attached to a cancelled grant — gets one message that does
 * not say which of those it was.
 *
 * Nothing on this path creates a dating profile or starts onboarding. The account that comes out of it is a staff
 * account and only that.
 */
export default async function StaffSetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const invite = token ? await describeInvite(getDb(), token) : null;

  if (!token || !invite) {
    return (
      <StaffPortalShell title="Admin Portal">
        <Callout tone="danger" title="That link can't be used">
          It has expired, has already been used, or was cancelled. Ask an administrator to send a new invitation.
        </Callout>
      </StaffPortalShell>
    );
  }

  return (
    <StaffPortalShell
      title={invite.setup ? "Set up your admin account" : "Set your admin password"}
      subtitle={`Choose a password for ${invite.email}.`}
      footer={invite.setup ? `You'll sign in with this address as ${invite.role === "ADMIN" ? "an administrator" : "a moderator"}.` : undefined}
    >
      <StaffSetPasswordForm token={token} mode="claim" />
    </StaffPortalShell>
  );
}

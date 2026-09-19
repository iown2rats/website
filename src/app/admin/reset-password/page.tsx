import { StaffPortalShell } from "@/components/features/staff/portal-shell";
import { StaffSetPasswordForm } from "@/components/features/staff/portal-forms";
import { Callout } from "@/components/ui/alert";

export const metadata = { title: "Choose a new password · Mellocrush" };
export const dynamic = "force-dynamic";

/**
 * The token is deliberately NOT validated here. Checking it on render would turn a page load — which a mail
 * client can make on its own — into a consumed link, and it would let anyone probe which tokens are live. The
 * server action that saves the password is the only thing that looks at it.
 */
export default async function StaffResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <StaffPortalShell title="Choose a new password">
        <Callout tone="danger" title="That link is incomplete">
          Open the link from your email again, or ask for a new one from the portal sign-in.
        </Callout>
      </StaffPortalShell>
    );
  }
  return (
    <StaffPortalShell title="Choose a new password" subtitle="This signs out every other session for your account.">
      <StaffSetPasswordForm token={token} mode="reset" />
    </StaffPortalShell>
  );
}

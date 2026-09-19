import { notFound, redirect } from "next/navigation";
import { BootstrapForm } from "@/components/features/admin/bootstrap-form";
import { Callout } from "@/components/ui/alert";
import { PageOverlay } from "@/components/layout/page-overlay";
import { getDb } from "@/lib/db";
import { isBootstrapAvailable } from "@/server/admin/bootstrap";
import { getAuthState } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Admin setup" };
export const dynamic = "force-dynamic";

/**
 * First-admin claim (docs/ARCHITECTURE.md §21.2). Exists only while ADMIN_BOOTSTRAP_TOKEN is configured and no
 * administrator exists; otherwise it is a 404 like any other unknown page.
 */
export default async function AdminBootstrapPage() {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect(ROUTES.welcome);
  // Already operational: there is nothing to claim.
  if (state.kind === "staff") redirect(ROUTES.staffHome);
  if (state.kind === "unverified") redirect(ROUTES.verifyEmail);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
  if (!(await isBootstrapAvailable(getDb()))) notFound();
  return (
    <PageOverlay title="Admin setup" backHref="/settings">
      <Callout tone="ocean" title="One-time setup">
        No administrator exists yet. Enter the bootstrap token from the server environment to make the account you are signed in with the first administrator. This page disappears once an administrator exists, and the token should then be removed from the environment.
      </Callout>
      <BootstrapForm />
    </PageOverlay>
  );
}

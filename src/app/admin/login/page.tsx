import { redirect } from "next/navigation";
import { StaffPortalShell } from "@/components/features/staff/portal-shell";
import { StaffSignInForm } from "@/components/features/staff/portal-forms";
import { getAdminActor } from "@/server/admin/authz";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Admin Portal · Mellocrush" };
export const dynamic = "force-dynamic";

/**
 * The admin portal sign-in (docs/ARCHITECTURE.md §22.1). Staff authenticate here with an email address and a
 * password; there is no member sign-in on this page, no provider button and no route into the dating app.
 */
export default async function StaffLoginPage() {
  if (await getAdminActor()) redirect(ROUTES.staffHome);
  return (
    <StaffPortalShell title="Admin Portal" subtitle="Sign in to manage Mellocrush.">
      <StaffSignInForm />
    </StaffPortalShell>
  );
}

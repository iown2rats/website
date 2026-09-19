import { redirect } from "next/navigation";
import { StaffPortalShell } from "@/components/features/staff/portal-shell";
import { StaffForgotPasswordForm } from "@/components/features/staff/portal-forms";
import { getAdminActor } from "@/server/admin/authz";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Reset admin password · Mellocrush" };
export const dynamic = "force-dynamic";

export default async function StaffForgotPasswordPage() {
  if (await getAdminActor()) redirect(ROUTES.staffHome);
  return (
    <StaffPortalShell title="Reset your password" subtitle="We'll email a link to your admin address.">
      <StaffForgotPasswordForm />
    </StaffPortalShell>
  );
}

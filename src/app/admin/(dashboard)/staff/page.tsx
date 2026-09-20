import { AdminPage } from "@/components/features/admin/admin-ui";
import { StaffManager, type StaffRow } from "@/components/features/admin/staff-manager";
import { getDb } from "@/lib/db";
import { hasPermission, requireStaffPage } from "@/server/admin/authz";
import { listStaffGrants } from "@/server/staff/grants";

export const metadata = { title: "Staff · Admin" };
export const dynamic = "force-dynamic";

/**
 * Staff management (docs/ARCHITECTURE.md §22.2). Visible to any staff account that can see the dashboard, but only
 * an ADMIN (the `users.role` permission) can change anything — the buttons are hidden for a moderator and every
 * action re-checks the permission server-side regardless.
 */
export default async function AdminStaffPage() {
  const admin = await requireStaffPage("dashboard.view");
  const canManage = hasPermission(admin.role, "users.role");
  const grants = await listStaffGrants(getDb());
  const rows: StaffRow[] = grants.map((g) => ({
    id: g.id,
    email: g.email,
    role: g.role,
    reason: g.reason,
    status: g.status,
    createdAt: g.createdAt.toISOString(),
    createdByEmail: g.createdByEmail,
    claimedAt: g.claimedAt?.toISOString() ?? null,
    revokedAt: g.revokedAt?.toISOString() ?? null,
    inviteExpiresAt: g.inviteExpiresAt?.toISOString() ?? null,
    isSelf: g.claimedByUserId === admin.userId,
  }));
  return (
    <AdminPage title="Staff" description="Who can use the admin portal. Staff accounts have no dating profile and never appear in Mellocrush itself.">
      <StaffManager rows={rows} canManage={canManage} />
    </AdminPage>
  );
}

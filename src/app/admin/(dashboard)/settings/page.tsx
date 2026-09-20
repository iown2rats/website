import { AdminPage, KeyValueList, Panel, RowLink } from "@/components/features/admin/admin-ui";
import { StaffSettingsActions } from "@/components/features/admin/staff-settings";
import { getDb } from "@/lib/db";
import { hasPermission, requireStaffPage } from "@/server/admin/authz";

export const metadata = { title: "Settings · Admin" };
export const dynamic = "force-dynamic";

/**
 * Staff settings (docs/ARCHITECTURE.md §22.1, §15). Operational only: who you are signed in as, what you may do,
 * when the password last changed, and how to change it or sign out. There is deliberately nothing here about a
 * profile, photos, discovery, notifications or Plus — a staff account has none of that.
 */
export default async function AdminSettingsPage() {
  const admin = await requireStaffPage("dashboard.view");
  const db = getDb();
  const [identity, grant] = await Promise.all([
    db.authIdentity.findFirst({ where: { userId: admin.userId, provider: "EMAIL", releasedAt: null }, select: { email: true, passwordUpdatedAt: true, lastLoginAt: true } }),
    db.staffGrant.findUnique({ where: { claimedByUserId: admin.userId }, select: { role: true, claimedAt: true, createdBy: { select: { identities: { where: { releasedAt: null }, select: { email: true }, take: 1 } } } } }),
  ]);
  const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
  return (
    <AdminPage title="Settings" description="Your admin account.">
      <div className="flex flex-col gap-5">
        <Panel title="Account">
          <KeyValueList
            items={[
              { label: "Email", value: identity?.email ?? "—", mono: true },
              { label: "Role", value: admin.role === "ADMIN" ? "Administrator" : "Moderator" },
              { label: "Staff since", value: fmt(grant?.claimedAt) },
              { label: "Added by", value: grant?.createdBy?.identities[0]?.email ?? "—" },
            ]}
          />
        </Panel>
        <Panel title="Security" description="Changing your password signs out every other session for this account.">
          <KeyValueList
            items={[
              { label: "Password last changed", value: fmt(identity?.passwordUpdatedAt) },
              { label: "Last sign-in", value: fmt(identity?.lastLoginAt) },
            ]}
          />
          <StaffSettingsActions email={identity?.email ?? null} />
        </Panel>
        {hasPermission(admin.role, "welcome-cover.manage") ? (
          <Panel title="App settings" description="Things about the app itself rather than your account.">
            <RowLink href="/admin/settings/welcome" primary="Welcome Screen" secondary="The cover behind the sign-in screen: upload, preview, schedule and publish." />
          </Panel>
        ) : null}
      </div>
    </AdminPage>
  );
}

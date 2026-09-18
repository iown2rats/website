import Link from "next/link";
import { AdminPage, DefinitionList, StatCard, StatGrid } from "@/components/features/admin/admin-ui";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { getDashboardMetrics, METRIC_DEFINITIONS } from "@/server/admin/metrics";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await requireAdminPage("dashboard.view");
  const m = await getDashboardMetrics();
  const d = METRIC_DEFINITIONS;
  return (
    <AdminPage title="Dashboard" description={`Counted from live records at ${formatDateTime(m.generatedAt)} (Maldives time).`}>
      <section className="flex flex-col gap-3">
        <h2 className="text-label uppercase text-text-secondary">Needs attention</h2>
        <StatGrid>
          <Link href="/admin/payments?filter=pending"><StatCard label="Payments to review" value={m.payments.pending} hint={d["membership.pendingReview"]} tone={m.payments.pending > 0 ? "attention" : "default"} /></Link>
          <Link href="/admin/reports?filter=open"><StatCard label="Open reports" value={m.safety.openReports} hint={d["safety.openReports"]} tone={m.safety.openReports > 0 ? "attention" : "default"} /></Link>
          <Link href="/admin/verifications"><StatCard label="Pending verifications" value={m.safety.pendingVerifications} hint={d["safety.pendingVerifications"]} tone={m.safety.pendingVerifications > 0 ? "attention" : "default"} /></Link>
          <Link href="/admin/subscriptions?filter=expiring"><StatCard label="Plus expiring (7 days)" value={m.membership.expiring7d} hint={d["membership.expiring7d"]} /></Link>
        </StatGrid>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-label uppercase text-text-secondary">Users</h2>
        <StatGrid>
          <StatCard label="Registered (all time)" value={m.users.total} hint={d["users.total"]} />
          <StatCard label="Not deleted" value={m.users.nonDeleted} hint={d["users.nonDeleted"]} />
          <StatCard label="Completed profiles" value={m.users.completedProfiles} hint={d["users.completedProfiles"]} />
          <StatCard label="Still onboarding" value={m.users.onboarding} hint={d["users.onboarding"]} />
          <StatCard label="New today" value={m.users.newToday} hint={d["users.newToday"]} />
          <StatCard label="New, 7 days" value={m.users.new7d} hint={d["users.new7d"]} />
          <StatCard label="New, 30 days" value={m.users.new30d} hint={d["users.new30d"]} />
          <StatCard label="Signed in, 7 days" value={m.users.signedIn7d} hint={d["users.signedIn7d"]} />
          <StatCard label="Signed in, 30 days" value={m.users.signedIn30d} hint={d["users.signedIn30d"]} />
          <StatCard label="Paused dating" value={m.users.paused} hint={d["users.paused"]} />
          <StatCard label="Suspended" value={m.users.suspended} hint={d["users.suspended"]} />
          <StatCard label="Banned" value={m.users.banned} hint={d["users.banned"]} />
          <StatCard label="Deleted" value={m.users.deleted} hint={d["users.deleted"]} />
        </StatGrid>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-label uppercase text-text-secondary">Membership and payments</h2>
        <StatGrid>
          <StatCard label="Plus now" value={m.membership.plusNow} hint={d["membership.plusNow"]} />
          <StatCard label="Awaiting payment" value={m.membership.awaitingPayment} hint={d["membership.awaitingPayment"]} />
          <StatCard label="Approved, 30 days" value={m.payments.approved30d} hint={d["payments.approved30d"]} />
          <StatCard label="Rejected, 30 days" value={m.payments.rejected30d} hint={d["payments.rejected30d"]} />
        </StatGrid>
      </section>
      <DefinitionList definitions={d} />
    </AdminPage>
  );
}

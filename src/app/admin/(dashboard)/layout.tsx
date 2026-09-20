import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/features/admin/admin-shell";
import { getDb } from "@/lib/db";
import { getAdminActor } from "@/server/admin/authz";
import { countPendingPhotos } from "@/server/admin/photo-moderation";
import { getAuthState } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";

/*
 * The signed-in half of the admin portal (docs/ARCHITECTURE.md §22.1). Everything under this layout requires a
 * live staff account; the portal's own sign-in, invitation and password screens sit outside it, which is what
 * lets them render while signed out.
 *
 * Three different visitors get three different answers on purpose:
 *   anonymous            → the portal sign-in screen
 *   a dating member      → the same 404 a missing page gives, so the portal is never confirmed to exist
 *   a live staff account → the dashboard
 *
 * Every page below re-checks its own permission, and every mutation re-checks in its server action. This layout is
 * the first gate, never the only one.
 */
export const dynamic = "force-dynamic";

export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const admin = await getAdminActor();
  if (!admin) {
    const state = await getAuthState();
    if (state.kind === "anonymous") redirect(ROUTES.staffSignIn);
    // Signed in but not staff — including a revoked or still-pending staff account. Nothing here exists for them.
    notFound();
  }
  const db = getDb();
  const [payments, reports, verifications, photos] = await Promise.all([
    db.subscriptionOrder.count({ where: { status: "SUBMITTED" } }),
    db.report.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    db.verification.count({ where: { status: { in: ["SELFIE_SUBMITTED", "UNDER_REVIEW"] } } }),
    countPendingPhotos(db),
  ]);
  return (
    <AdminShell role={admin.role} badges={{ payments, reports, verifications, photos }}>
      {children}
    </AdminShell>
  );
}

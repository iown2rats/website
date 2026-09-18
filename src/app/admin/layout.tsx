import type { ReactNode } from "react";
import { AdminShell } from "@/components/features/admin/admin-shell";
import { getDb } from "@/lib/db";
import { requireAdminPage } from "@/server/admin/authz";
import { countPendingPhotos } from "@/server/admin/photo-moderation";

// Every admin screen is private and per-request; a non-admin gets the same 404 as a missing page.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdminPage();
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

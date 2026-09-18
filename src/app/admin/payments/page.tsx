import { AdminPage, FilterLinks, Pagination, RowLink, RowList, StatusPill } from "@/components/features/admin/admin-ui";
import { formatDateTime } from "@/lib/format";
import { getDb } from "@/lib/db";
import { requireAdminPage } from "@/server/admin/authz";
import { listOrdersForAdmin, type PaymentQueueFilter } from "@/server/billing/approval";

export const metadata = { title: "Payments · Admin" };
export const dynamic = "force-dynamic";

const FILTERS: PaymentQueueFilter[] = ["pending", "approved", "rejected", "all"];

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const admin = await requireAdminPage("payments.review");
  const sp = await searchParams;
  const filter = (FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as PaymentQueueFilter) : "pending";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const db = getDb();
  const [result, pending, approved, rejected, all] = await Promise.all([
    listOrdersForAdmin(admin, filter, { page }),
    db.subscriptionOrder.count({ where: { status: "SUBMITTED" } }),
    db.subscriptionOrder.count({ where: { status: "APPROVED" } }),
    db.subscriptionOrder.count({ where: { status: "REJECTED" } }),
    db.subscriptionOrder.count(),
  ]);
  const counts: Record<PaymentQueueFilter, number> = { pending, approved, rejected, all };
  return (
    <AdminPage title="Payments" description="Manual bank transfers. Pending orders have a receipt waiting for your decision.">
      <FilterLinks current={filter} items={FILTERS.map((f) => ({ value: f, label: f[0]!.toUpperCase() + f.slice(1), href: `/admin/payments?filter=${f}`, count: counts[f] }))} />
      <RowList empty={filter === "pending" ? "Nothing to review right now." : "No orders here."}>
        {result.items.map((o) => (
          <RowLink
            key={o.id}
            href={`/admin/payments/${o.id}`}
            primary={<><span className="font-mono">{o.reference}</span> · {o.amountLabel}</>}
            secondary={`${o.planName} · ${o.user.displayName ?? "(no name)"}${o.user.handle ? " @" + o.user.handle : ""}`}
            badges={<><StatusPill status={o.status} />{o.verification ? <StatusPill status={o.verification.outcome} label={`OCR: ${o.verification.outcome.replace(/_/g, " ").toLowerCase()}`} /> : null}</>}
            trailing={o.status === "SUBMITTED" ? `Submitted ${formatDateTime(o.submittedAt)}` : o.decidedAt ? `Decided ${formatDateTime(o.decidedAt)}` : `Created ${formatDateTime(o.createdAt)}`}
          />
        ))}
      </RowList>
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(p) => `/admin/payments?filter=${filter}&page=${p}`} />
    </AdminPage>
  );
}

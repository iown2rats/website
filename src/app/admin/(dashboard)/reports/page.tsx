import { AdminPage, FilterLinks, Pagination, RowLink, RowList, StatusPill } from "@/components/features/admin/admin-ui";
import { REPORT_REASON_LABELS } from "@/constants/labels";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { listReports, type ReportQueueFilter } from "@/server/admin/moderation";

export const metadata = { title: "Reports · Admin" };
export const dynamic = "force-dynamic";

const FILTERS: ReportQueueFilter[] = ["open", "resolved", "all"];

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const admin = await requireAdminPage("reports.act");
  const sp = await searchParams;
  const filter = (FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as ReportQueueFilter) : "open";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const result = await listReports(admin, { filter, page });
  return (
    <AdminPage title="Reports" description="Reports filed by members. Submitting a report also blocked the reported person for the reporter.">
      <FilterLinks current={filter} items={FILTERS.map((f) => ({ value: f, label: f[0]!.toUpperCase() + f.slice(1), href: `/admin/reports?filter=${f}` }))} />
      <RowList empty={filter === "open" ? "No open reports." : "No reports here."}>
        {result.items.map((r) => (
          <RowLink
            key={r.id}
            href={`/admin/reports/${r.id}`}
            primary={REPORT_REASON_LABELS[r.reason as keyof typeof REPORT_REASON_LABELS] ?? r.reason}
            secondary={`${r.target.kind} · ${r.target.displayName ?? "(unknown)"}${r.target.handle ? " @" + r.target.handle : ""} · reported by ${r.reporter.displayName ?? "(unknown)"}`}
            badges={<StatusPill status={r.status} />}
            trailing={formatDateTime(r.createdAt)}
          />
        ))}
      </RowList>
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(p) => `/admin/reports?filter=${filter}&page=${p}`} />
    </AdminPage>
  );
}

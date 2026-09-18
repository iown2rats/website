import Link from "next/link";
import { AdminPage, FilterLinks, Pagination, RowList } from "@/components/features/admin/admin-ui";
import { formatDateTime } from "@/lib/format";
import { listAuditLog } from "@/server/admin/audit-list";
import { requireAdminPage } from "@/server/admin/authz";

export const metadata = { title: "Audit log · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ action?: string; targetId?: string; actorId?: string; page?: string }> }) {
  const admin = await requireAdminPage("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const result = await listAuditLog(admin, { action: sp.action, targetId: sp.targetId, actorId: sp.actorId, page });
  const query = (overrides: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ action: sp.action, targetId: sp.targetId, actorId: sp.actorId, ...overrides })) if (v) q.set(k, v);
    return `/admin/audit?${q.toString()}`;
  };
  return (
    <AdminPage title="Audit log" description="Every privileged action, newest first. Entries are never edited or deleted from the dashboard.">
      <FilterLinks label="Action" current={sp.action ?? ""} items={[{ value: "", label: "All actions", href: query({ action: undefined, page: undefined }) }, ...result.actions.map((a) => ({ value: a, label: a, href: query({ action: a, page: undefined }) }))]} />
      {sp.targetId || sp.actorId ? (
        <p className="text-caption text-text-secondary">
          Filtered to {sp.targetId ? `target ${sp.targetId}` : ""}{sp.actorId ? `actor ${sp.actorId}` : ""}. <Link href="/admin/audit" className="font-semibold text-primary-pressed hover:underline">Clear</Link>
        </p>
      ) : null}
      <RowList empty="No audit entries yet.">
        {result.items.map((e) => (
          <div key={e.id} className="flex flex-col gap-1.5 border-b border-border px-4 py-3 last:border-0">
            <div className="flex flex-wrap items-center gap-2 text-caption">
              <span className="font-mono font-bold text-text">{e.action}</span>
              <span className="text-text-secondary">by {e.actor ? <Link href={`/admin/users/${e.actor.userId}`} className="font-semibold text-primary-pressed hover:underline">{e.actor.displayName ?? e.actor.userId}</Link> : "system"}</span>
              {e.targetType ? (
                <span className="text-text-secondary">
                  on {e.targetType} {e.targetType === "User" && e.targetId ? <Link href={`/admin/users/${e.targetId}`} className="font-mono hover:underline">{e.targetId}</Link> : e.targetType === "SubscriptionOrder" && e.targetId ? <Link href={`/admin/payments/${e.targetId}`} className="font-mono hover:underline">{e.targetId}</Link> : <span className="font-mono">{e.targetId}</span>}
                </span>
              ) : null}
              <span className="ml-auto text-text-secondary">{formatDateTime(e.createdAt)}</span>
            </div>
            {e.data ? <pre className="overflow-x-auto rounded-lg bg-surface-muted p-2 text-[11px] leading-snug text-text-secondary">{JSON.stringify(e.data, null, 1)}</pre> : null}
          </div>
        ))}
      </RowList>
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(p) => query({ page: String(p) })} />
    </AdminPage>
  );
}

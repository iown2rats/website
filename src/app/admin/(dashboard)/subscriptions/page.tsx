import Link from "next/link";
import { AdminPage, FilterLinks, Pagination, RowList, StatusPill } from "@/components/features/admin/admin-ui";
import { SubscriptionAdjust } from "@/components/features/admin/subscription-adjust";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { formatShortDate, relativeDays } from "@/lib/format";
import { hasPermission, requireAdminPage } from "@/server/admin/authz";
import { listSubscriptionsForAdmin, type SubscriptionFilter } from "@/server/billing/subscriptions";

export const metadata = { title: "Subscriptions · Admin" };
export const dynamic = "force-dynamic";

const FILTERS: SubscriptionFilter[] = ["active", "expiring", "expired", "all"];

export default async function AdminSubscriptionsPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; page?: string }> }) {
  const admin = await requireAdminPage("subscriptions.view");
  const sp = await searchParams;
  const filter = (FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as SubscriptionFilter) : "active";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const result = await listSubscriptionsForAdmin(admin, { filter, q: sp.q, page });
  const canAdjust = hasPermission(admin.role, "subscriptions.adjust");
  const base = (f: SubscriptionFilter, p = 1) => `/admin/subscriptions?filter=${f}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}&page=${p}`;
  return (
    <AdminPage title="Subscriptions" description="Plus periods created by approved payments. Whether someone holds Plus is derived from the period end, never from a status flag.">
      <FilterLinks current={filter} items={FILTERS.map((f) => ({ value: f, label: f === "expiring" ? "Expiring (7 days)" : f[0]!.toUpperCase() + f.slice(1), href: base(f) }))} />
      <form method="get" action="/admin/subscriptions" className="flex gap-2">
        <input type="hidden" name="filter" value={filter} />
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name, handle, user id or payment reference" className="h-11 flex-1" />
        <Button type="submit" variant="ocean" size="sm" className="h-11">Search</Button>
      </form>
      <RowList empty="No subscriptions here.">
        {result.items.map((s) => (
          <div key={s.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0 desktop:flex-row desktop:items-center desktop:gap-4">
            <div className="min-w-0 flex-1">
              <Link href={`/admin/users/${s.user.userId}`} className="truncate text-body-sm font-medium text-text hover:underline">{s.user.displayName ?? "(no name)"}{s.user.handle ? ` @${s.user.handle}` : ""}</Link>
              <div className="text-caption text-text-secondary">
                {s.planName} ({s.planCode}) · {s.provider.replace(/_/g, " ")}{s.orderReference ? ` · ${s.orderReference}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill status={s.granting ? "PLUS" : "EXPIRED"} label={s.granting ? "Plus" : "not granting"} />
              <StatusPill status={s.status} />
            </div>
            <div className="text-caption text-text-secondary desktop:w-56 desktop:text-right">
              {formatShortDate(s.currentPeriodStart)} → {formatShortDate(s.currentPeriodEnd)} <span className="whitespace-nowrap">({relativeDays(s.currentPeriodEnd)})</span>
            </div>
            {canAdjust ? <SubscriptionAdjust subscriptionId={s.id} currentPeriodEnd={s.currentPeriodEnd} /> : null}
          </div>
        ))}
      </RowList>
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(p) => base(filter, p)} />
    </AdminPage>
  );
}

import { AdminPage, Pagination, RowLink, RowList, StatusPill } from "@/components/features/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { formatShortDate } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { searchUsers, type AccountStatus, type MembershipFilter, type OnboardingFilter, type VerificationFilter } from "@/server/admin/users";

export const metadata = { title: "Users · Admin" };
export const dynamic = "force-dynamic";

type Params = { q?: string; status?: string; onboarding?: string; verification?: string; membership?: string; from?: string; to?: string; page?: string };

const STATUSES: (AccountStatus | "all")[] = ["all", "ACTIVE", "ONBOARDING", "SUSPENDED", "BANNED", "DELETED"];

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const admin = await requireAdminPage("users.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const status = (STATUSES as string[]).includes(sp.status ?? "") ? (sp.status as AccountStatus | "all") : "all";
  const result = await searchUsers(admin, { q: sp.q, status, onboarding: (sp.onboarding as OnboardingFilter) ?? "all", verification: (sp.verification as VerificationFilter) ?? "all", membership: (sp.membership as MembershipFilter) ?? "all", joinedFrom: sp.from, joinedTo: sp.to, page });
  const query = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as [string, string][]);
  const hrefFor = (p: number) => `/admin/users?${new URLSearchParams({ ...Object.fromEntries(query), page: String(p) }).toString()}`;
  return (
    <AdminPage title="Users" description="Search by public name, handle or internal id. Filters combine.">
      <form method="get" action="/admin/users" className="grid grid-cols-1 gap-3 rounded-2xl glass-card p-4 desktop:grid-cols-4">
        <label className="flex flex-col gap-1 text-caption font-medium text-text-secondary desktop:col-span-2">
          Search
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name, handle or user id" className="h-11 text-body-sm" />
        </label>
        <label className="flex flex-col gap-1 text-caption font-medium text-text-secondary">
          Account state
          <Select name="status" defaultValue={status} className="[&>select]:h-11 [&>select]:text-body-sm [&>select]:font-medium">
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === "all" ? "Any" : s}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-medium text-text-secondary">
          Onboarding
          <Select name="onboarding" defaultValue={sp.onboarding ?? "all"} className="[&>select]:h-11 [&>select]:text-body-sm [&>select]:font-medium">
            <option value="all">Any</option>
            <option value="complete">Complete</option>
            <option value="incomplete">Incomplete</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-medium text-text-secondary">
          Verification
          <Select name="verification" defaultValue={sp.verification ?? "all"} className="[&>select]:h-11 [&>select]:text-body-sm [&>select]:font-medium">
            <option value="all">Any</option>
            <option value="NONE">Unverified</option>
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-medium text-text-secondary">
          Membership
          <Select name="membership" defaultValue={sp.membership ?? "all"} className="[&>select]:h-11 [&>select]:text-body-sm [&>select]:font-medium">
            <option value="all">Any</option>
            <option value="plus">Plus</option>
            <option value="free">Free</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-medium text-text-secondary">
          Joined from
          <Input type="date" name="from" defaultValue={sp.from ?? ""} className="h-11 text-body-sm" />
        </label>
        <label className="flex flex-col gap-1 text-caption font-medium text-text-secondary">
          Joined to
          <Input type="date" name="to" defaultValue={sp.to ?? ""} className="h-11 text-body-sm" />
        </label>
        <div className="flex items-end gap-2 desktop:col-span-4">
          <Button type="submit" variant="ocean" size="sm">Search</Button>
          <Button type="button" variant="ghost" size="sm" formAction="/admin/users" formMethod="get">Reset</Button>
          <span className="ml-auto self-center text-caption text-text-secondary">{result.total} match{result.total === 1 ? "" : "es"}</span>
        </div>
      </form>
      <RowList empty="No users match these filters.">
        {result.items.map((u) => (
          <RowLink
            key={u.userId}
            href={`/admin/users/${u.userId}`}
            primary={u.displayName ?? "(no name yet)"}
            secondary={`${u.handle ? "@" + u.handle + " · " : ""}${u.userId}`}
            badges={
              <>
                <StatusPill status={u.status} />
                {u.role !== "USER" ? <StatusPill status={u.role} /> : null}
                <StatusPill status={u.tier} />
                {u.verificationStatus === "VERIFIED" ? <StatusPill status="VERIFIED" /> : null}
                {!u.onboardingComplete && u.status !== "ONBOARDING" ? <StatusPill status="ONBOARDING" label="incomplete" /> : null}
              </>
            }
            trailing={`Joined ${formatShortDate(u.createdAt)}`}
          />
        ))}
      </RowList>
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />
    </AdminPage>
  );
}

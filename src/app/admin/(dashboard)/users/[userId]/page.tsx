import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPage, KeyValueList, Panel, RowLink, RowList, StatusPill } from "@/components/features/admin/admin-ui";
import { UserActions } from "@/components/features/admin/user-actions";
import { CONNECTION_INTENT_LABELS, INTENT_LABELS, INTERESTED_IN_LABELS, REPORT_REASON_LABELS } from "@/constants/labels";
import { formatDateTime, formatShortDate } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { getUserDetail } from "@/server/admin/users";

export const metadata = { title: "User · Admin" };
export const dynamic = "force-dynamic";

/** Never shows a password hash or a token hash: the DTO does not carry them (src/server/admin/users.ts). */
const PROVIDER_LABELS = { GOOGLE: "Google", TELEGRAM: "Telegram", EMAIL: "Email" } as const;
const LOCATION_SCOPE_LABELS: Record<string, string> = { ANYWHERE: "Anywhere in Maldives", GREATER_MALE: "Greater Malé", MY_ATOLL: "My atoll" };

export default async function AdminUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const admin = await requireAdminPage("users.view");
  const { userId } = await params;
  const d = await getUserDetail(admin, userId).catch(() => null);
  if (!d) notFound();
  const a = d.account;
  return (
    <AdminPage
      title={a.displayName ?? "(no name yet)"}
      description={`${a.handle ? "@" + a.handle + " · " : ""}${a.userId}`}
      backHref={{ href: "/admin/users", label: "Users" }}
      actions={
        <>
          <StatusPill status={a.status} />
          <StatusPill status={a.role} />
          <StatusPill status={d.membership.tier} />
        </>
      }
    >
      <Panel title="Actions" description="Every action needs a reason and is written to the audit log.">
        <UserActions userId={a.userId} status={a.status} role={a.role} actorRole={admin.role} isSelf={a.userId === admin.userId} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 desktop:grid-cols-2">
        <Panel title="Account">
          <KeyValueList
            items={[
              { label: "Status", value: <StatusPill status={a.status} /> },
              { label: "Role", value: a.role },
              { label: "Onboarding", value: a.onboardingCompletedAt ? `Complete · ${formatShortDate(a.onboardingCompletedAt)}` : `In progress · ${a.onboardingStage}` },
              { label: "Joined", value: formatDateTime(a.createdAt) },
              { label: "Last sign-in", value: formatDateTime(a.lastActiveAt) },
              { label: "Age", value: a.ageYears !== null ? `${a.ageYears}` : "—" },
              { label: "Phone on file", value: a.hasPhone ? "Yes (never shown here)" : "No" },
              { label: "Open sessions", value: String(a.activeSessions) },
              { label: "Signs in with", value: d.signIn ? `${PROVIDER_LABELS[d.signIn.provider]} · ${d.signIn.account ?? "—"}` : "—" },
              ...(d.signIn?.emailVerified !== null && d.signIn?.emailVerified !== undefined ? [{ label: "Email address", value: d.signIn.emailVerified ? "Email verified" : "Email unverified" }] : []),
              { label: "Last sign-in via provider", value: formatDateTime(d.signIn?.lastLoginAt) },
              ...(a.deletedAt ? [{ label: "Deleted", value: formatDateTime(a.deletedAt) }] : []),
            ]}
          />
        </Panel>
        <Panel title="Profile">
          {d.profile ? (
            <KeyValueList
              items={[
                { label: "Location", value: d.profile.location ?? "—" },
                { label: "Intent", value: d.profile.intent ?? "—" },
                { label: "Photos", value: `${d.profile.photos.approved} approved · ${d.profile.photos.pending} pending · ${d.profile.photos.rejected} rejected` },
                { label: "Bio", value: d.profile.bioLength ? `${d.profile.bioLength} characters` : "Empty" },
                { label: "Interests / prompts", value: `${d.profile.interests} / ${d.profile.prompts}` },
                { label: "Visibility", value: d.privacy ? `${d.privacy.paused ? "Paused" : d.privacy.visibility}${d.privacy.invisibleMode ? " · Invisible Mode on" : ""}` : "—" },
              ]}
            />
          ) : (
            <p className="text-body-sm text-text-secondary">No profile row yet.</p>
          )}
        </Panel>
        <Panel title="Discovery preferences" description="Read-only. What this member is here for and their own filters — for diagnosing who can see whom. Dating is opposite gender and Friendship is everyone in the pool, automatically; stored legacy values are shown for history and have no effect.">
          {d.discovery ? (
            <KeyValueList
              items={[
                { label: "I'm here for", value: CONNECTION_INTENT_LABELS[d.discovery.connectionIntent] },
                // Legacy. Neither decides who anybody sees, except in a Friendship pair with a "Prefer not to say" member.
                { label: "Show me (legacy)", value: `${INTERESTED_IN_LABELS[d.discovery.showMe]} · not used by discovery` },
                { label: "Friendship preference (legacy)", value: d.discovery.friendshipShowMe ? `${INTERESTED_IN_LABELS[d.discovery.friendshipShowMe]} · not used by discovery` : "Not answered" },
                { label: "Age range", value: `${d.discovery.ageMin}–${d.discovery.ageMax}${d.discovery.ownAgeOutsideRange ? " · excludes their own age" : ""}` },
                { label: "Location scope", value: d.discovery.locationScope === "SPECIFIC" ? `Specific · ${d.discovery.specificLocation ?? "—"}` : LOCATION_SCOPE_LABELS[d.discovery.locationScope] ?? d.discovery.locationScope },
                ...(d.discovery.datingLookingFor ? [{ label: "Looking for (legacy)", value: `${INTENT_LABELS[d.discovery.datingLookingFor as keyof typeof INTENT_LABELS] ?? d.discovery.datingLookingFor} · not used by discovery` }] : []),
                { label: "Discoverable", value: d.privacy ? (d.privacy.paused ? "Paused" : d.privacy.visibility === "EVERYONE" ? "Visible" : "Hidden") + (d.privacy.invisibleMode ? " · Invisible Mode on" : "") : "—" },
              ]}
            />
          ) : (
            <p className="text-body-sm text-text-secondary">No discovery preferences row.</p>
          )}
        </Panel>
        <Panel title="Verification">
          <KeyValueList
            items={[
              { label: "Status", value: <StatusPill status={d.verification.status} /> },
              { label: "Selfie submitted", value: d.verification.hasSelfie ? "Yes" : "No" },
              { label: "Submitted", value: formatDateTime(d.verification.submittedAt) },
              { label: "Decided", value: formatDateTime(d.verification.decidedAt) },
              { label: "Rejection reason", value: d.verification.rejectionReason ?? "—" },
            ]}
          />
        </Panel>
        <Panel title="Membership">
          <KeyValueList
            items={[
              { label: "Tier now", value: <StatusPill status={d.membership.tier} /> },
              { label: "Current period ends", value: formatDateTime(d.membership.periodEnd) },
              { label: "Source", value: d.membership.overridden ? "Entitlement override" : d.membership.tier === "PLUS" ? "Subscription" : "—" },
            ]}
          />
          {d.membership.subscriptions.length > 0 ? (
            <ul className="mt-4 flex flex-col divide-y divide-border text-caption">
              {d.membership.subscriptions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium text-text">{s.planName}</span>
                  <span className="text-text-secondary">{formatShortDate(s.currentPeriodStart)} → {formatShortDate(s.currentPeriodEnd)}</span>
                  <StatusPill status={s.status} />
                  {s.orderReference ? <span className="font-mono">{s.orderReference}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </div>

      <Panel title="Orders">
        <RowList empty="No orders.">
          {d.orders.map((o) => (
            <RowLink key={o.id} href={`/admin/payments/${o.id}`} primary={<span className="font-mono">{o.reference}</span>} secondary={`${o.planName} · ${o.amountLabel}`} badges={<StatusPill status={o.status} />} trailing={formatDateTime(o.submittedAt ?? o.createdAt)} />
          ))}
        </RowList>
      </Panel>

      <Panel title="Safety" description={`${d.safety.reportsReceived} report${d.safety.reportsReceived === 1 ? "" : "s"} received (${d.safety.openReportsReceived} open) · ${d.safety.reportsFiled} filed · blocked ${d.safety.blocksGiven} · blocked by ${d.safety.blocksReceived}`}>
        <RowList empty="No reports about this account.">
          {d.safety.recentReports.map((r) => (
            <RowLink key={r.id} href={`/admin/reports/${r.id}`} primary={REPORT_REASON_LABELS[r.reason as keyof typeof REPORT_REASON_LABELS] ?? r.reason} badges={<StatusPill status={r.status} />} trailing={formatDateTime(r.createdAt)} />
          ))}
        </RowList>
      </Panel>

      <Panel title="Audit history" description="Privileged actions that targeted this account.">
        {d.audit.length === 0 ? (
          <p className="text-body-sm text-text-secondary">Nothing recorded.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {d.audit.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-2.5 text-caption">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium text-text">{e.action}</span>
                  <span className="text-text-secondary">by {e.actor}</span>
                  <span className="ml-auto text-text-secondary">{formatDateTime(e.createdAt)}</span>
                </div>
                {e.data ? <pre className="overflow-x-auto rounded-lg bg-surface-muted p-2 text-tiny leading-snug text-text-secondary">{JSON.stringify(e.data, null, 1)}</pre> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-caption text-text-secondary">
          Full log: <Link href={`/admin/audit?targetId=${a.userId}`} className="font-medium text-primary-ink hover:underline">audit entries for this user</Link>
        </p>
      </Panel>
    </AdminPage>
  );
}

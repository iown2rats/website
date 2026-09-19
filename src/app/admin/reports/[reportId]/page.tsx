import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPage, KeyValueList, Panel, StatusPill } from "@/components/features/admin/admin-ui";
import { ReportDecision } from "@/components/features/admin/report-decision";
import { REPORT_REASON_LABELS } from "@/constants/labels";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { getReportDetail } from "@/server/admin/moderation";

export const metadata = { title: "Report · Admin" };
export const dynamic = "force-dynamic";

type SnapshotMessage = { id: string; from: "reporter" | "target"; kind: string; body: string; at: string };

export default async function AdminReportDetailPage({ params }: { params: Promise<{ reportId: string }> }) {
  const admin = await requireAdminPage("reports.act");
  const { reportId } = await params;
  const r = await getReportDetail(admin, reportId).catch(() => null);
  if (!r) notFound();
  const snapshot = r.snapshot as { conversationId?: string; messages?: SnapshotMessage[] } | null;
  return (
    <AdminPage title={REPORT_REASON_LABELS[r.reason as keyof typeof REPORT_REASON_LABELS] ?? r.reason} description={`Filed ${formatDateTime(r.createdAt)}`} backHref={{ href: "/admin/reports", label: "Reports" }} actions={<StatusPill status={r.status} />}>
      <Panel title="Decision" description="Resolving records the outcome. Account actions (suspend, ban) are taken from the reported person's page.">
        <ReportDecision reportId={r.id} status={r.status} />
      </Panel>
      <div className="grid grid-cols-1 gap-4 desktop:grid-cols-2">
        <Panel title="Reported">
          <KeyValueList
            items={[
              { label: "What", value: r.target.kind },
              { label: "Who", value: r.target.userId ? <Link href={`/admin/users/${r.target.userId}`} className="font-medium text-primary-ink hover:underline">{r.target.displayName ?? "(unknown)"}{r.target.handle ? ` @${r.target.handle}` : ""}</Link> : "—" },
              { label: "Account state", value: r.target.accountStatus ? <StatusPill status={r.target.accountStatus} /> : "—" },
              { label: "Other open reports about them", value: String(r.targetOpenReports) },
              ...(r.content ? [{ label: "Reported content", value: <span className="whitespace-pre-wrap">{r.content}</span> }] : []),
            ]}
          />
        </Panel>
        <Panel title="Reporter and outcome">
          <KeyValueList
            items={[
              { label: "Reporter", value: <Link href={`/admin/users/${r.reporter.userId}`} className="font-medium text-primary-ink hover:underline">{r.reporter.displayName ?? "(unknown)"}{r.reporter.handle ? ` @${r.reporter.handle}` : ""}</Link> },
              { label: "Note", value: r.note ? <span className="whitespace-pre-wrap">{r.note}</span> : "—" },
              { label: "Resolution", value: r.resolution ?? "—" },
              { label: "Decided", value: r.resolvedAt ? `${formatDateTime(r.resolvedAt)}${r.resolvedBy ? ` by ${r.resolvedBy}` : ""}` : "—" },
            ]}
          />
        </Panel>
      </div>
      <Panel title="Evidence snapshot" description="The conversation as it was when the report was filed (up to 50 messages). Later deletions do not change it.">
        {snapshot?.messages && snapshot.messages.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {[...snapshot.messages].reverse().map((m) => (
              <li key={m.id} className={m.from === "target" ? "self-start max-w-[85%] rounded-2xl rounded-bl-sm bg-surface-muted px-3.5 py-2" : "self-end max-w-[85%] rounded-2xl rounded-br-sm bg-aqua-soft px-3.5 py-2"}>
                <div className="text-tiny font-medium uppercase tracking-[.06em] text-text-secondary">{m.from === "target" ? "Reported person" : "Reporter"} · {m.kind.toLowerCase()} · {formatDateTime(m.at)}</div>
                <div className="whitespace-pre-wrap text-body-sm text-text">{m.body}</div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-body-sm text-text-secondary">No message snapshot on this report.</p>
        )}
      </Panel>
    </AdminPage>
  );
}

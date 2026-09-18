import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPage, KeyValueList, Panel, StatusPill } from "@/components/features/admin/admin-ui";
import { VerificationDecision } from "@/components/features/admin/verification-decision";
import { Callout } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { getVerificationDetail } from "@/server/admin/verification";

export const metadata = { title: "Verification · Admin" };
export const dynamic = "force-dynamic";

/*
 * One verification, for a human to decide (docs/ARCHITECTURE.md §11): the selfie beside the member's profile photos,
 * when it was submitted, how many attempts, earlier decisions, and Verify / Reject with confirmation. The images are
 * short-lived signed URLs to the private bucket. Nothing here scores similarity; the reviewer does the comparing.
 */
export default async function AdminVerificationDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const admin = await requireAdminPage("verification.act");
  const { userId } = await params;
  const d = await getVerificationDetail(admin, userId).catch(() => null);
  if (!d) notFound();
  const pending = d.status === "SELFIE_SUBMITTED" || d.status === "UNDER_REVIEW";
  const isOwn = d.userId === admin.userId;
  return (
    <AdminPage title={d.displayName ?? "(no name)"} description={d.handle ? `@${d.handle}` : undefined} backHref={{ href: "/admin/verifications", label: "Verifications" }} actions={<StatusPill status={d.status} />}>
      <Panel title="Decision" description="Photo verified means only that the selfie shows the same person as the profile photos. It says nothing about identity, age or background.">
        {pending ? (
          isOwn ? <p className="text-body-sm text-text-secondary">This is your own verification. Another reviewer must decide it.</p> : <VerificationDecision userId={d.userId} hasSelfie={Boolean(d.selfieUrl)} />
        ) : (
          <p className="text-body-sm text-text-secondary">Nothing is waiting for a decision. The member can submit again{d.status === "REJECTED" ? " 24 hours after the last decision" : ""}.</p>
        )}
        {d.accountStatus !== "ACTIVE" ? <Callout tone="warning" title={`Account is ${d.accountStatus.toLowerCase()}`} className="mt-3">Verifying does not change the account state. Suspended or banned members stay that way.</Callout> : null}
      </Panel>
      <div className="grid grid-cols-1 gap-4 desktop:grid-cols-2">
        <Panel title="Verification selfie" description="Taken by the member for this check. Private; the link expires in a few minutes.">
          {d.selfieUrl ? (
            <a href={d.selfieUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-surface-muted">
              {/* Signed, short-lived URL to private storage; a plain img keeps it that way. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.selfieUrl} alt={`Verification selfie submitted by ${d.displayName ?? "the member"}`} className="mx-auto max-h-[60vh] w-auto max-w-full object-contain" />
            </a>
          ) : (
            <p className="text-body-sm text-text-secondary">No selfie on file.</p>
          )}
        </Panel>
        <Panel title="Profile photos" description="What other members see. All moderation states are shown here so the comparison is complete.">
          {d.profilePhotos.length === 0 ? (
            <p className="text-body-sm text-text-secondary">No profile photos.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2" aria-label="Profile photos">
              {d.profilePhotos.map((p) => (
                <li key={p.id} className="relative aspect-[3/4] overflow-hidden rounded-lg bg-surface-muted">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={`Profile photo ${p.position + 1}`} className="size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center text-caption text-text-secondary">demo</span>
                  )}
                  <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">{p.moderation.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-4 desktop:grid-cols-2">
        <Panel title="Submission">
          <KeyValueList
            items={[
              { label: "Member", value: <Link href={`/admin/users/${d.userId}`} className="font-semibold text-primary-ink hover:underline">Open member page</Link> },
              { label: "Account state", value: <StatusPill status={d.accountStatus} /> },
              { label: "Status", value: <StatusPill status={d.status} /> },
              { label: "Submitted", value: formatDateTime(d.submittedAt) },
              { label: "Attempts", value: String(d.attempts) },
              { label: "Decided", value: d.decidedAt ? `${formatDateTime(d.decidedAt)}${d.reviewedBy ? ` by ${d.reviewedBy.displayName ?? "admin"}` : ""}` : "—" },
              ...(d.rejectionReason ? [{ label: "Reason shown to the member", value: d.rejectionReason }] : []),
            ]}
          />
        </Panel>
        <Panel title="Earlier decisions" description="From the audit log.">
          {d.history.length === 0 ? (
            <p className="text-body-sm text-text-secondary">No earlier decisions.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-body-sm">
              {d.history.map((h) => (
                <li key={h.at} className="flex flex-wrap items-baseline gap-x-2 border-b border-border pb-2 last:border-0">
                  <StatusPill status={h.decision} />
                  <span className="text-text-secondary">{formatDateTime(h.at)}{h.reviewer ? ` · ${h.reviewer}` : ""}</span>
                  {h.reason ? <span className="w-full text-caption text-text">{h.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}

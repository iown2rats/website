import Link from "next/link";
import { AdminPage, RowList, StatusPill } from "@/components/features/admin/admin-ui";
import { VerificationDecision } from "@/components/features/admin/verification-decision";
import { Callout } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { getVerificationEvidenceUrl, listVerificationQueue } from "@/server/admin/verification";

export const metadata = { title: "Verifications · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminVerificationsPage() {
  const admin = await requireAdminPage("verification.act");
  const queue = await listVerificationQueue(admin);
  const evidence = await Promise.all(queue.items.map((v) => (v.hasSelfie ? getVerificationEvidenceUrl(admin, v.userId).catch(() => null) : Promise.resolve(null))));
  return (
    <AdminPage title="Verifications" description="Selfie checks waiting for a decision. Google sign-in is never evidence of identity.">
      <Callout tone="info" title="Selfie upload is not built yet">Members cannot submit a selfie in this version, so this queue stays empty. When the verification workflow ships, submissions appear here with the selfie for comparison; nobody can be marked verified without one.</Callout>
      <RowList empty="Nothing waiting for review.">
        {queue.items.map((v, i) => (
          <div key={v.userId} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0 desktop:flex-row desktop:items-center desktop:gap-4">
            <div className="min-w-0 flex-1">
              <Link href={`/admin/users/${v.userId}`} className="truncate text-body-sm font-bold text-text hover:underline">{v.displayName ?? "(no name)"}{v.handle ? ` @${v.handle}` : ""}</Link>
              <div className="text-caption text-text-secondary">Submitted {formatDateTime(v.submittedAt)} · attempt {v.attempts}</div>
            </div>
            <StatusPill status={v.status} />
            {evidence[i] ? <a href={evidence[i]!} target="_blank" rel="noreferrer" className="text-caption font-semibold text-primary-pressed hover:underline">View selfie</a> : null}
            <VerificationDecision userId={v.userId} hasSelfie={v.hasSelfie} />
          </div>
        ))}
      </RowList>
    </AdminPage>
  );
}

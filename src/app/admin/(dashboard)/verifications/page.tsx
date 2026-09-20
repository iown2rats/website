import Link from "next/link";
import { AdminPage, RowLink, RowList, StatusPill } from "@/components/features/admin/admin-ui";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { listVerificationQueue } from "@/server/admin/verification";

export const metadata = { title: "Verifications · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminVerificationsPage() {
  const admin = await requireAdminPage("verification.act");
  const queue = await listVerificationQueue(admin);
  return (
    <AdminPage title="Verifications" description="Selfies waiting for a human decision. Compare the selfie with the profile photos; Google sign-in is never evidence.">
      <RowList empty="Nothing waiting for review.">
        {queue.items.map((v) => (
          <RowLink
            key={v.userId}
            href={`/admin/verifications/${v.userId}`}
            primary={<>{v.displayName ?? "(no name)"}{v.handle ? <span className="font-normal text-text-secondary"> @{v.handle}</span> : null}</>}
            secondary={`Submitted ${formatDateTime(v.submittedAt)} · attempt ${v.attempts}${v.hasSelfie ? "" : " · no selfie on file"}`}
            badges={<StatusPill status={v.status} />}
            trailing="Review"
          />
        ))}
      </RowList>
      <p className="text-caption text-text-secondary">
        Decided verifications are visible on each member&apos;s page under <Link href="/admin/users" className="font-medium text-primary-ink hover:underline">Users</Link>.
      </p>
    </AdminPage>
  );
}

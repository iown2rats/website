import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPage, KeyValueList, Panel, StatusPill } from "@/components/features/admin/admin-ui";
import { PaymentReview } from "@/components/features/admin/payment-review";
import { ReceiptCheckPanel } from "@/components/features/admin/receipt-check";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { getOrderForAdmin } from "@/server/billing/approval";

export const metadata = { title: "Payment · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPaymentDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const admin = await requireAdminPage("payments.review");
  const { orderId } = await params;
  const o = await getOrderForAdmin(admin, orderId).catch(() => null);
  if (!o) notFound();
  return (
    <AdminPage title={o.reference} description={`${o.planName} · ${o.amountLabel}`} backHref={{ href: "/admin/payments", label: "Payments" }} actions={<StatusPill status={o.status} />}>
      <Panel title="Decision">
        <PaymentReview orderId={o.id} status={o.status} amountLabel={o.amountLabel} planName={o.planName} reference={o.reference} isOwn={o.user.userId === admin.userId} needsReason={o.approvalNeedsReason} />
      </Panel>
      <div className="grid grid-cols-1 gap-4 desktop:grid-cols-2">
        <Panel title="Order">
          <KeyValueList
            items={[
              { label: "Reference", value: o.reference, mono: true },
              { label: "Status", value: <StatusPill status={o.status} /> },
              { label: "Plan", value: `${o.planName}${o.planCode ? ` (${o.planCode})` : ""}` },
              { label: "Amount", value: o.amountLabel },
              { label: "Duration", value: `${o.durationDays} days` },
              { label: "Created", value: formatDateTime(o.createdAt) },
              { label: "Submitted", value: formatDateTime(o.submittedAt) },
              { label: "Decided", value: o.decidedAt ? `${formatDateTime(o.decidedAt)}${o.decidedBy ? ` by ${o.decidedBy.displayName ?? "admin"}` : ""}` : "—" },
              ...(o.rejectionReason ? [{ label: "Rejection reason", value: o.rejectionReason }] : []),
              ...(o.periodEnd ? [{ label: "Plus period ends", value: formatDateTime(o.periodEnd) }] : []),
            ]}
          />
        </Panel>
        <Panel title="Customer and payment method">
          <KeyValueList
            items={[
              { label: "Customer", value: <Link href={`/admin/users/${o.user.userId}`} className="font-semibold text-primary-ink hover:underline">{o.user.displayName ?? "(no name)"}{o.user.handle ? ` @${o.user.handle}` : ""}</Link> },
              { label: "Account state", value: <StatusPill status={o.user.status} /> },
              { label: "Method", value: o.method.label },
              { label: "Bank", value: o.method.bankName },
              { label: "Account holder", value: o.method.accountHolder },
              { label: "Account number", value: o.method.accountNumber, mono: true },
            ]}
          />
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-4 desktop:grid-cols-2">
        <Panel title="Receipt" description={o.hasReceipt ? "Uploaded by the customer. The link expires in a few minutes. Always compare the image with the check." : undefined}>
        {o.receiptUrl ? (
          <a href={o.receiptUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-border bg-surface-muted">
            {/* Signed, short-lived URL to private storage; a plain img keeps it that way. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.receiptUrl} alt={`Receipt for ${o.reference}`} className="mx-auto max-h-[70vh] w-auto max-w-full object-contain" />
          </a>
        ) : (
          <p className="text-body-sm text-text-secondary">No receipt has been uploaded for this order.</p>
        )}
        </Panel>
        <Panel title="Receipt check (OCR)" description="Read automatically from the stored image. Advisory: it approves nothing.">
          <ReceiptCheckPanel orderId={o.id} verification={o.verification} history={o.verificationHistory} canRerun={o.hasReceipt} />
        </Panel>
      </div>
    </AdminPage>
  );
}

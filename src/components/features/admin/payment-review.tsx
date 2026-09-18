"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApprovePayment, adminRejectPayment } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ReasonDialog } from "./reason-dialog";

/**
 * Approve / Reject with confirmation. The server decides validity, idempotency and entitlement; this only asks. When
 * the latest receipt check is a material mismatch or a duplicate, approving asks for a reason (recorded in the audit
 * log) instead of a plain confirmation; the server enforces the same rule.
 */
export function PaymentReview({ orderId, status, amountLabel, planName, reference, isOwn, needsReason = false }: { orderId: string; status: string; amountLabel: string; planName: string; reference: string; isOwn: boolean; needsReason?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (status !== "SUBMITTED") return <p className="text-body-sm text-text-secondary">This order is {status.toLowerCase().replace("_", " ")}; no review action is available.</p>;
  if (isOwn) return <p className="text-body-sm text-text-secondary">This is your own order. Another administrator must review it.</p>;

  const approve = async (reason?: string) => {
    setBusy(true);
    const r = await adminApprovePayment(orderId, reason ? { reason } : undefined).catch(() => null);
    setBusy(false);
    setApproveOpen(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "That didn't go through.");
    toast.show(r.data.alreadyApproved ? "Already approved earlier" : "Payment approved · Plus activated");
    router.refresh();
  };
  const reject = async (reason: string) => {
    setBusy(true);
    const r = await adminRejectPayment(orderId, { reason }).catch(() => null);
    setBusy(false);
    setRejectOpen(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "That didn't go through.");
    toast.show("Payment rejected");
    router.refresh();
  };
  const approveDescription = `Confirms that ${amountLabel} was received for ${planName}. Plus activates immediately for the purchased duration (or extends the current paid period). This is recorded in the audit log.`;
  return (
    <div className="flex flex-col gap-2.5">
      {needsReason ? <p className="text-caption text-warning">The receipt check found a mismatch or a duplicate. Approving is still your call once you have found the transfer in the bank statement, but you must record why.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="ocean" size="sm" onClick={() => setApproveOpen(true)}>Approve payment</Button>
        <Button variant="destructive" size="sm" onClick={() => setRejectOpen(true)}>Reject</Button>
      </div>
      {needsReason ? (
        <ReasonDialog open={approveOpen} onClose={() => setApproveOpen(false)} onConfirm={(reason) => void approve(reason)} loading={busy} title={`Approve ${reference} despite the receipt check?`} description={approveDescription} confirmLabel="Approve and activate Plus" reasonLabel="Why you are approving anyway (recorded in the audit log)" />
      ) : (
        <ConfirmationDialog open={approveOpen} onClose={() => setApproveOpen(false)} onConfirm={() => void approve()} loading={busy} title={`Approve ${reference}?`} description={approveDescription} confirmLabel="Approve and activate Plus" />
      )}
      <ReasonDialog open={rejectOpen} onClose={() => setRejectOpen(false)} onConfirm={reject} loading={busy} title={`Reject ${reference}?`} description="Plus is not activated. The customer sees your reason on their Membership screen and can start a new order." confirmLabel="Reject payment" confirmVariant="destructive" reasonLabel="Reason shown to the customer" />
    </div>
  );
}

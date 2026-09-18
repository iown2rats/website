"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApprovePayment, adminRejectPayment } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ReasonDialog } from "./reason-dialog";

/** Approve / Reject with confirmation. The server decides validity, idempotency and entitlement; this only asks. */
export function PaymentReview({ orderId, status, amountLabel, planName, reference, isOwn }: { orderId: string; status: string; amountLabel: string; planName: string; reference: string; isOwn: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (status !== "SUBMITTED") return <p className="text-body-sm text-text-secondary">This order is {status.toLowerCase().replace("_", " ")}; no review action is available.</p>;
  if (isOwn) return <p className="text-body-sm text-text-secondary">This is your own order. Another administrator must review it.</p>;

  const approve = async () => {
    setBusy(true);
    const r = await adminApprovePayment(orderId).catch(() => null);
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
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="ocean" size="sm" onClick={() => setApproveOpen(true)}>Approve payment</Button>
      <Button variant="destructive" size="sm" onClick={() => setRejectOpen(true)}>Reject</Button>
      <ConfirmationDialog open={approveOpen} onClose={() => setApproveOpen(false)} onConfirm={approve} loading={busy} title={`Approve ${reference}?`} description={`Confirms that ${amountLabel} was received for ${planName}. Plus activates immediately for the purchased duration (or extends the current paid period). This is recorded in the audit log.`} confirmLabel="Approve and activate Plus" />
      <ReasonDialog open={rejectOpen} onClose={() => setRejectOpen(false)} onConfirm={reject} loading={busy} title={`Reject ${reference}?`} description="Plus is not activated. The customer sees your reason on their Membership screen and can start a new order." confirmLabel="Reject payment" confirmVariant="destructive" reasonLabel="Reason shown to the customer" />
    </div>
  );
}

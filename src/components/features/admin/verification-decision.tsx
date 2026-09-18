"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminDecideVerification } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ReasonDialog } from "./reason-dialog";

export function VerificationDecision({ userId, hasSelfie }: { userId: string; hasSelfie: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!hasSelfie) return <span className="text-caption text-text-secondary">No selfie on file; cannot be decided.</span>;
  const decide = async (decision: "VERIFIED" | "REJECTED", reason = "") => {
    setBusy(true);
    const r = await adminDecideVerification(userId, { decision, reason }).catch(() => null);
    setBusy(false);
    setApproveOpen(false);
    setRejectOpen(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "That didn't go through.");
    toast.show(decision === "VERIFIED" ? "Verified" : "Rejected");
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="ocean" onClick={() => setApproveOpen(true)}>Verify</Button>
      <Button size="sm" variant="destructive" onClick={() => setRejectOpen(true)}>Reject</Button>
      <ConfirmationDialog open={approveOpen} onClose={() => setApproveOpen(false)} onConfirm={() => void decide("VERIFIED")} loading={busy} title="Mark as photo verified?" description="Only after comparing the selfie with the profile photos yourself. The badge appears on their profile immediately and means exactly that: the photos show this person." confirmLabel="Verify" />
      <ReasonDialog open={rejectOpen} onClose={() => setRejectOpen(false)} onConfirm={(r) => void decide("REJECTED", r)} loading={busy} title="Reject verification" description="The person sees this reason and can try again." confirmLabel="Reject" confirmVariant="destructive" reasonLabel="Reason shown to the person" />
    </div>
  );
}

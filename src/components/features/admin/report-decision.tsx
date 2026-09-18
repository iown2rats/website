"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminDecideReport } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ReasonDialog } from "./reason-dialog";

export function ReportDecision({ reportId, status }: { reportId: string; status: string }) {
  const router = useRouter();
  const toast = useToast();
  const [resolveOpen, setResolveOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const terminal = status === "RESOLVED" || status === "DISMISSED";
  if (terminal) return <p className="text-body-sm text-text-secondary">This report is {status.toLowerCase()}.</p>;
  const decide = async (next: "UNDER_REVIEW" | "RESOLVED" | "DISMISSED", resolution = "") => {
    setBusy(true);
    const r = await adminDecideReport(reportId, { status: next, resolution }).catch(() => null);
    setBusy(false);
    setResolveOpen(false);
    setDismissOpen(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "That didn't go through.");
    toast.show(`Report ${next.toLowerCase().replace("_", " ")}`);
    router.refresh();
  };
  return (
    <div className="flex flex-wrap gap-2">
      {status === "OPEN" ? <Button size="sm" variant="secondary" onClick={() => void decide("UNDER_REVIEW")} disabled={busy}>Mark under review</Button> : null}
      <Button size="sm" variant="ocean" onClick={() => setResolveOpen(true)}>Resolve</Button>
      <Button size="sm" variant="destructive" onClick={() => setDismissOpen(true)}>Dismiss</Button>
      <ReasonDialog open={resolveOpen} onClose={() => setResolveOpen(false)} onConfirm={(r) => void decide("RESOLVED", r)} loading={busy} title="Resolve this report" description="Record what was done (for example: account suspended, content removed, warning sent). Take account actions from the target's page." confirmLabel="Resolve report" reasonLabel="Resolution (audit log)" />
      <ConfirmationDialog open={dismissOpen} onClose={() => setDismissOpen(false)} onConfirm={() => void decide("DISMISSED")} loading={busy} title="Dismiss this report?" description="No action against the reported person. The report stays on record." confirmLabel="Dismiss" confirmVariant="destructive" />
    </div>
  );
}

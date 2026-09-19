"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminAdjustSubscription } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ReasonDialog } from "./reason-dialog";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Privileged period change: new end date + reason, audited with before/after on the server. */
export function SubscriptionAdjust({ subscriptionId, currentPeriodEnd }: { subscriptionId: string; currentPeriodEnd: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState(toLocalInput(currentPeriodEnd));
  const [busy, setBusy] = useState(false);
  const submit = async (reason: string) => {
    setBusy(true);
    const r = await adminAdjustSubscription(subscriptionId, { currentPeriodEnd: new Date(end).toISOString(), reason }).catch(() => null);
    setBusy(false);
    setOpen(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "That didn't go through.");
    toast.show("Period updated");
    router.refresh();
  };
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Adjust period</Button>
      <ReasonDialog open={open} onClose={() => setOpen(false)} onConfirm={submit} loading={busy} title="Adjust subscription period" description="Use this only for support cases (a lost day, a goodwill extension). The previous and new dates are written to the audit log." confirmLabel="Save new end date">
        <Field label="New period end (your local time)">{(p) => <Input {...p} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="h-11" />}</Field>
      </ReasonDialog>
    </>
  );
}

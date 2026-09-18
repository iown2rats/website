"use client";

import { useId, useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";

/** Confirmation that also collects the reason every audited admin action requires. */
export function ReasonDialog({ open, onClose, onConfirm, title, description, confirmLabel, confirmVariant = "ocean", loading = false, reasonLabel = "Reason (recorded in the audit log)", optional = false, children }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void; title: string; description?: string; confirmLabel: string; confirmVariant?: ButtonVariant; loading?: boolean; reasonLabel?: string; optional?: boolean; children?: ReactNode }) {
  const titleId = useId();
  const [reason, setReason] = useState("");
  const valid = optional || reason.trim().length >= 3;
  return (
    <ResponsiveDialog open={open} onClose={onClose} labelledBy={titleId} dismissible={!loading}>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      {description ? <DialogDescription>{description}</DialogDescription> : null}
      {children}
      <Field label={reasonLabel} hint={optional ? undefined : "At least 3 characters."}>{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} />}</Field>
      <div className="flex flex-col gap-2.5 pt-1">
        <Button variant={confirmVariant} onClick={() => onConfirm(reason.trim())} loading={loading} disabled={!valid} fullWidth>
          {confirmLabel}
        </Button>
        <Button variant="muted" size="md" onClick={onClose} disabled={loading} fullWidth>
          Cancel
        </Button>
      </div>
    </ResponsiveDialog>
  );
}

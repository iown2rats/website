"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { PlusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { LockIcon } from "@/components/ui/icons";

/**
 * The one lock state for Plus features (docs/ARCHITECTURE.md §12): what the feature is, that it is part of Plus, and
 * a single way forward to Membership. Membership itself shows the honest state when nothing is for sale, so this
 * never leads into a dead checkout. Locks are UX only; every paid capability is refused on the server regardless.
 */
export function PlusLockSheet({ open, onClose, feature, description, children }: { open: boolean; onClose: () => void; feature: string; description: string; children?: ReactNode }) {
  const titleId = useId();
  return (
    <ResponsiveDialog open={open} onClose={onClose} labelledBy={titleId}>
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sand/20 text-text" aria-hidden="true"><LockIcon size={20} /></span>
        <div className="min-w-0">
          <DialogTitle id={titleId}>{feature}</DialogTitle>
          <div className="mt-0.5"><PlusTag size="sm" label="Plus feature" /></div>
        </div>
      </div>
      <DialogDescription>{description}</DialogDescription>
      {children}
      <div className="flex flex-col gap-2.5 pt-1">
        <Link href="/settings/membership" onClick={onClose} className="flex h-13 items-center justify-center rounded-lg bg-primary text-body-lg font-medium text-on-primary pressable">Upgrade to Plus</Link>
        <Button variant="muted" size="md" onClick={onClose} fullWidth>Not now</Button>
      </div>
    </ResponsiveDialog>
  );
}

/** Inline lock row for lists: label, "Plus feature", chevron-less button that opens the sheet. */
export function PlusLockRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-13 w-full items-center justify-between border-0 bg-surface px-4.5 text-body font-medium text-text">
      <span className="flex items-center gap-2">{label}<PlusTag size="xs" /></span>
      <LockIcon size={16} className="text-text-secondary" aria-hidden="true" />
    </button>
  );
}

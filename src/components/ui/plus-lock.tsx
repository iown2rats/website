"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { PlusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { LockIcon } from "@/components/ui/icons";
import { membershipHref, type PlusSurface } from "@/lib/plus-surfaces";
import { trackPlusClick, usePlusPromptView } from "@/components/features/analytics/plus-track";

/**
 * The one lock state for Plus features (docs/ARCHITECTURE.md §12): what the feature is, that it is part of Plus, and
 * a single way forward to Membership. Membership itself shows the honest state when nothing is for sale, so this
 * never leads into a dead checkout. Locks are UX only; every paid capability is refused on the server regardless.
 *
 * A locked tap always lands here first rather than jumping straight to /settings/membership (approved 2026-09-20):
 * arriving on a pricing page with no idea which tap caused it is worse than one short sentence of context. What
 * that costs is a step, so the step is kept to the minimum that answers two questions — what is locked (the title)
 * and what Plus does about it (one sentence) — and then offers exactly one way forward. Descriptions here are one
 * short sentence by rule; anything longer belongs on Membership, which is one tap away. Counts and prices are NOT
 * repeated here, both to keep it short and so this copy cannot drift from src/config/product.ts.
 *
 * "Get MelloCrush Plus" is the label everywhere a control actually leads to Membership (the like-limit dialog and
 * the Membership CTA use the same words); a control that only opens this sheet is named after the locked feature
 * instead, so two buttons in a row never both read as "upgrade".
 */
export function PlusLockSheet({ open, onClose, feature, description, surface, children }: { open: boolean; onClose: () => void; feature: string; description: string; /** Which promotion this is, carried to Membership as `?from=` (a closed list). */ surface?: PlusSurface; children?: ReactNode }) {
  const titleId = useId();
  // Funnel (§12.19): opening the sheet is seeing the promotion; its one CTA is the tap. Best-effort, never blocking.
  usePlusPromptView(surface, open);
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
      {/* One primary action, at the house `lg` height rather than the 52 px this sheet used before the compact pass.
          "Not now" is the dismiss, and it stays filled rather than ghost: the sheet is glass, so a transparent
          button at the foot of it puts its label straight over the bottom navigation showing through. */}
      <div className="flex flex-col gap-2 pt-0.5">
        <Link href={membershipHref(surface)} onClick={() => { if (surface) trackPlusClick(surface); onClose(); }} className="inline-flex h-11.5 items-center justify-center rounded-lg bg-primary px-5 text-cta-lg text-on-primary pressable">Get MelloCrush Plus</Link>
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

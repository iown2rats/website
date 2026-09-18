"use client";

import { useId, useState } from "react";
import { blockAuthorOfComment, blockAuthorOfPost, removeComment, removePost, reportCommunityComment, reportCommunityPost, type CommunityFailure } from "@/actions/community";
import { REPORT_REASON_LABELS } from "@/constants/labels";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { call } from "./call";
import { ActionSheet, BottomSheet, ConfirmationDialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

/*
 * Safety menu for Community content (prototype: ··· on a post opens Report; Block is the separate action in the
 * prototype's report flow). Reporting a post or comment stores a report only — it never blocks the author; the
 * report confirmation offers Block as an explicit second step. Authors get Delete instead. Every action is
 * confirmed and re-authorised on the server.
 */

export interface ContentTarget {
  kind: "post" | "comment";
  id: string;
  authorName: string;
  authorHandle: string;
  isMine: boolean;
}

type ReasonKey = keyof typeof REPORT_REASON_LABELS;
const REASONS = Object.entries(REPORT_REASON_LABELS) as [ReasonKey, string][];

type Step = "menu" | "report" | "reported" | "confirm-block" | "confirm-delete";

export interface ContentMenuProps {
  target: ContentTarget | null;
  onClose: () => void;
  onDeleted: (target: ContentTarget) => void;
  onBlocked: (target: ContentTarget) => void;
}

export function ContentMenu({ target, onClose, onDeleted, onBlocked }: ContentMenuProps) {
  const toast = useToast();
  const titleId = useId();
  const [step, setStep] = useState<Step>("menu");
  const [reason, setReason] = useState<ReasonKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);

  // A new target resets the flow (adjust state during render; no effect needed).
  const key = target ? `${target.kind}:${target.id}` : null;
  if (key !== openFor) {
    setOpenFor(key);
    setStep("menu");
    setReason(null);
    setBusy(false);
  }

  const close = () => {
    if (busy) return;
    onClose();
  };

  const fail = (r: CommunityFailure) => {
    toast.show(r.message);
    setBusy(false);
  };

  const submitReport = async () => {
    if (!target || !reason) return;
    setBusy(true);
    const r = await call(() => (target.kind === "post" ? reportCommunityPost({ postId: target.id, reason }) : reportCommunityComment({ commentId: target.id, reason })));
    if (!r.ok) return fail(r);
    setBusy(false);
    setStep("reported");
  };

  const block = async () => {
    if (!target) return;
    setBusy(true);
    const r = await call(() => (target.kind === "post" ? blockAuthorOfPost({ postId: target.id }) : blockAuthorOfComment({ commentId: target.id })));
    if (!r.ok) return fail(r);
    setBusy(false);
    onClose();
    toast.show(`Blocked. You and ${target.authorName} won't see each other on Thundi.`);
    onBlocked(target);
  };

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    const r = await call(() => (target.kind === "post" ? removePost({ postId: target.id }) : removeComment({ commentId: target.id })));
    if (!r.ok) return fail(r);
    setBusy(false);
    onClose();
    toast.show(target.kind === "post" ? "Post deleted" : "Comment deleted");
    onDeleted(target);
  };

  if (!target) return null;
  const noun = target.kind === "post" ? "post" : "comment";

  return (
    <>
      <ActionSheet
        open={step === "menu"}
        onClose={close}
        label={`${target.kind === "post" ? "Post" : "Comment"} options`}
        items={
          target.isMine
            ? [{ label: `Delete ${noun}`, tone: "danger", onSelect: () => setStep("confirm-delete") }]
            : [
                { label: `Report ${noun}`, onSelect: () => { setReason(null); setStep("report"); } },
                { label: `Block ${target.authorName}`, onSelect: () => setStep("confirm-block") },
              ]
        }
      />

      <BottomSheet open={step === "report" || step === "reported"} onClose={close} labelledBy={titleId} dismissible={!busy}>
        {step === "report" ? (
          <>
            <DialogTitle id={titleId} className="text-[22px]">Why are you reporting?</DialogTitle>
            <DialogDescription>Reports are anonymous and reviewed within 24 hours. Reporting this {noun} doesn&apos;t block {target.authorName} — you can choose that next.</DialogDescription>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Reason">
              {REASONS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={reason === value}
                  onClick={() => setReason(value)}
                  className={cn("h-12.5 rounded-lg border-[1.5px] px-4.5 text-left text-body font-semibold text-text", reason === value ? "border-primary bg-surface-muted" : "border-border bg-surface")}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button variant="ocean" onClick={() => void submitReport()} disabled={!reason} loading={busy} fullWidth>
              Submit report
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-aqua-soft text-primary-ink" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
              </span>
              <DialogTitle id={titleId} className="text-[22px]">Thanks for looking out</DialogTitle>
              <p className="max-w-75 text-body-sm leading-normal text-text-secondary">
                Our team will review this {noun}. {target.authorName} hasn&apos;t been blocked and won&apos;t know who reported it.
              </p>
            </div>
            <Button variant="secondary" size="md" onClick={() => void block()} loading={busy} fullWidth>
              Also block {target.authorName}
            </Button>
            <Button onClick={close} disabled={busy} fullWidth>
              Done
            </Button>
          </>
        )}
      </BottomSheet>

      <ConfirmationDialog
        open={step === "confirm-block"}
        onClose={close}
        onConfirm={() => void block()}
        title={`Block ${target.authorName}?`}
        description="You won't see each other's posts, comments or profiles anywhere on Thundi, and any conversation between you closes. Blocking is immediate."
        confirmLabel="Block"
        loading={busy}
      />
      <ConfirmationDialog
        open={step === "confirm-delete"}
        onClose={close}
        onConfirm={() => void remove()}
        title={`Delete this ${noun}?`}
        description={target.kind === "post" ? "It disappears from Community for everyone, along with its comments." : "It disappears from the thread for everyone."}
        confirmLabel="Delete"
        confirmVariant="destructive"
        loading={busy}
      />
    </>
  );
}

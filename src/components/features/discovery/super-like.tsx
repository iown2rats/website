"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { StarIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatResetIn, SUPER_LIKE_MESSAGE_MAX, superLikeAllowanceText, superLikeMessageLength, type SuperLikeAllowanceView } from "@/lib/super-likes";

/*
 * Super Like pieces (docs/ARCHITECTURE.md §12.20, DESIGN_SYSTEM.md). Gold is the Plus accent, so the star is gold;
 * everything else is the house vocabulary — glass cards, coral primary, compact type. Nothing here decides anything:
 * the server re-checks Plus, the allowance and the message on every send.
 */

/** The small "⭐ Super Like" pill on a card or tile. */
export function SuperLikeBadge({ label = "Super Like", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full bg-sand px-2.5 text-tag text-on-sand shadow-sm", className)}>
      <StarIcon size={12} filled strokeWidth={0} />
      {label}
    </span>
  );
}

/**
 * The Super Like on a full profile: who it came from (the label) and, if there is one, the message — always rendered
 * as text. Shown to a Plus recipient on Likes You, and to the sender on their own Sent list.
 */
export function SuperLikeNote({ label, message }: { label: string; message: string | null }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2 rounded-3xl glass-card p-4">
      <div className="flex items-center gap-1.5 text-body-sm font-medium text-text">
        <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-sand text-on-sand">
          <StarIcon size={13} filled strokeWidth={0} />
        </span>
        {label}
      </div>
      {message ? <p className="whitespace-pre-wrap break-words text-body-lg leading-normal text-text">“{message}”</p> : null}
    </section>
  );
}

export interface SuperLikeComposerProps {
  open: boolean;
  onClose: () => void;
  /** Their name, for the heading. */
  name: string;
  allowance: SuperLikeAllowanceView;
  /** The server-corrected clock (Discover's), so "Resets in" agrees with the server. */
  nowMs: () => number;
  sending: boolean;
  error: string | null;
  onSend: (message: string) => void;
}

/**
 * The Plus composer: an optional message (≤ 150 characters, counted as the server counts them) and one button. The
 * counter and the disabled state are courtesy; an over-long message is refused by the server either way.
 */
export function SuperLikeComposer({ open, onClose, name, allowance, nowMs, sending, error, onSend }: SuperLikeComposerProps) {
  const titleId = useId();
  const fieldId = useId();
  const counterId = useId();
  const [text, setText] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  // Every opening starts empty, so a message meant for one person is never sent to the next.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setText("");
  }
  const length = superLikeMessageLength(text);
  const over = length > SUPER_LIKE_MESSAGE_MAX;
  const { left, reset } = superLikeAllowanceText(allowance, nowMs());

  return (
    <ResponsiveDialog
      open={open}
      onClose={sending ? () => {} : onClose}
      dismissible={!sending}
      labelledBy={titleId}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="text-body-sm font-medium text-danger">{error}</p> : null}
          <Button onClick={() => onSend(text)} loading={sending} disabled={over} fullWidth leadingIcon={<StarIcon size={17} filled strokeWidth={0} />}>
            Send Super Like
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-sand text-on-sand">
          <StarIcon size={20} filled strokeWidth={0} />
        </span>
        <div className="min-w-0">
          <DialogTitle id={titleId}>Send a Super Like ⭐</DialogTitle>
          <DialogDescription className="mt-0.5">Stand out and say something first to {name}.</DialogDescription>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-body-sm font-medium text-text">
          Add a message <span className="font-normal text-text-secondary">(optional)</span>
        </label>
        {/* An opaque base under the field's usual tint: the sheet is glass over a photo card, and the card's name would
            otherwise show through the very text being written. */}
        <div className="rounded-lg bg-background">
          <Textarea
            id={fieldId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Your diving photo got my attention…"
            aria-describedby={counterId}
            aria-invalid={over || undefined}
            enterKeyHint="send"
            className="block"
          />
        </div>
        <div id={counterId} className={cn("self-end text-caption tabular-nums", over ? "font-medium text-danger" : "text-text-secondary")} aria-live="polite">
          {length} / {SUPER_LIKE_MESSAGE_MAX}
          {over ? <span className="sr-only"> — too long</span> : null}
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-text-secondary">
        <StarIcon size={13} filled strokeWidth={0} className="text-sand" />
        <span className="font-medium text-text">{left}</span>
        {reset ? <span>· {reset}</span> : null}
      </p>
    </ResponsiveDialog>
  );
}

/**
 * A Plus member who has used this window's Super Likes. They already have Plus, so this says when it resets —
 * never an upgrade or a pack (there is none).
 */
export function SuperLikesUsedDialog({ open, onClose, limit, resetsInMs }: { open: boolean; onClose: () => void; limit: number; resetsInMs: number | null }) {
  const titleId = useId();
  return (
    <ResponsiveDialog open={open} onClose={onClose} labelledBy={titleId}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-sand/25 text-sand">
          <StarIcon size={20} filled strokeWidth={0} />
        </span>
        <DialogTitle id={titleId}>You&apos;ve used your {limit} Super Likes</DialogTitle>
      </div>
      <DialogDescription>
        {resetsInMs != null && resetsInMs > 0 ? `Your Super Likes reset in ${formatResetIn(resetsInMs)}.` : "Your Super Likes will reset soon."}
      </DialogDescription>
      <Button variant="muted" size="md" onClick={onClose} fullWidth>OK</Button>
    </ResponsiveDialog>
  );
}

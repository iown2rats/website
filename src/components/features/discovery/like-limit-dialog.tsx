"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { HeartIcon } from "@/components/ui/icons";
import { formatDuration } from "@/lib/time";
import { trackPlusClick, usePlusPromptView } from "@/components/features/analytics/plus-track";

/*
 * Like allowance reached (Phase 6 §25–27). The countdown is computed from server time; when it reaches zero the
 * owner refreshes the allowance from the server.
 *
 * Free: "You've used today's likes", the real reset time, and the free path stated plainly — you can still browse and
 * pass — before one way to Plus ("Get Plus") and "Maybe later". The Plus allowance is passed in from the server's
 * rules, never written here, so this copy cannot drift from src/config/product.ts.
 * Plus: reset time only — Plus is not unlimited and there is no further tier, so there is nothing to sell.
 */
export interface LikeLimitDialogProps {
  open: boolean;
  onClose: () => void;
  limit: number;
  /** The Plus daily allowance, from the server's product rules. Shown to Free members only. */
  plusLimit: number;
  tier: "FREE" | "PLUS";
  resetsAt: string | null;
  serverTime: () => number;
  onCountdownDone: () => void;
  onGetPlus: () => void;
}

export function LikeLimitDialog({ open, onClose, limit, plusLimit, tier, resetsAt, serverTime, onCountdownDone, onGetPlus }: LikeLimitDialogProps) {
  const titleId = useId();
  const [remaining, setRemaining] = useState<number | null>(null);
  // Funnel (§12.19): only the Free dialog is a promotion; the Plus one has nothing to sell.
  usePlusPromptView(tier === "FREE" ? "daily_limit" : null, open);

  useEffect(() => {
    if (!open || !resetsAt) return;
    const target = Date.parse(resetsAt);
    let done = false;
    const tick = () => {
      const ms = target - serverTime();
      setRemaining(Math.max(0, ms));
      if (ms <= 0 && !done) {
        done = true;
        onCountdownDone();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open, resetsAt, serverTime, onCountdownDone]);

  return (
    <ResponsiveDialog open={open} onClose={onClose} labelledBy={titleId}>
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-aqua-soft text-primary-ink" aria-hidden="true">
          <HeartIcon size={28} filled strokeWidth={0} />
        </span>
        {tier === "FREE" ? (
          <>
            <DialogTitle id={titleId}>You&apos;ve used today&apos;s likes</DialogTitle>
            <DialogDescription className="mt-0">Come back when your likes reset, or keep swiping with Plus.</DialogDescription>
            <p className="text-caption text-text-secondary">
              {remaining != null ? <>Your likes reset in <b className="tabular-nums text-text">{formatDuration(remaining)}</b>.</> : "Your likes reset over the next 24 hours."}
              {" "}You can still browse and pass. MelloCrush Plus comes with {plusLimit} likes a day.
            </p>
          </>
        ) : (
          <>
            <DialogTitle id={titleId}>You&apos;ve used today&apos;s {limit} likes.</DialogTitle>
            <DialogDescription className="mt-0">
              {remaining != null ? <>Your likes refresh in <b className="tabular-nums text-text">{formatDuration(remaining)}</b>.</> : "Your likes refresh over the next 24 hours."}
              {" "}You can keep browsing and passing.
            </DialogDescription>
          </>
        )}
      </div>
      <div className="flex flex-col gap-2.5 pt-1">
        {tier === "FREE" ? (
          <Button variant="plus" onClick={() => { trackPlusClick("daily_limit"); onGetPlus(); }} fullWidth>Get Plus</Button>
        ) : null}
        <Button variant={tier === "FREE" ? "muted" : "primary"} size="md" onClick={onClose} fullWidth>
          {tier === "FREE" ? "Maybe later" : "Keep browsing"}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}

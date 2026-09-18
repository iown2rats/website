"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { HeartIcon } from "@/components/ui/icons";
import { formatDuration } from "@/lib/time";

/*
 * Like allowance reached (Phase 6 §25–27). Copy is exact: "You've used today's 30 likes." The countdown is
 * computed from server time; when it reaches zero the owner refreshes the allowance from the server.
 * Free: Get Mellocrush Plus / Maybe later. Plus (90): reset time only — Plus is not unlimited and there is no further tier.
 */
export interface LikeLimitDialogProps {
  open: boolean;
  onClose: () => void;
  limit: number;
  tier: "FREE" | "PLUS";
  resetsAt: string | null;
  serverTime: () => number;
  onCountdownDone: () => void;
  onGetPlus: () => void;
}

export function LikeLimitDialog({ open, onClose, limit, tier, resetsAt, serverTime, onCountdownDone, onGetPlus }: LikeLimitDialogProps) {
  const titleId = useId();
  const [remaining, setRemaining] = useState<number | null>(null);

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
        <DialogTitle id={titleId}>You&apos;ve used today&apos;s {limit} likes.</DialogTitle>
        <DialogDescription className="mt-0">
          {remaining != null ? <>Your likes refresh in <b className="tabular-nums text-text">{formatDuration(remaining)}</b>.</> : "Your likes refresh over the next 24 hours."}
          {" "}You can keep browsing and passing.
        </DialogDescription>
        {tier === "FREE" ? <p className="text-caption text-text-secondary">Mellocrush Plus comes with 90 likes a day.</p> : null}
      </div>
      <div className="flex flex-col gap-2.5 pt-1">
        {tier === "FREE" ? (
          <Button variant="plus" onClick={onGetPlus} fullWidth>Get Mellocrush Plus</Button>
        ) : null}
        <Button variant={tier === "FREE" ? "muted" : "primary"} size="md" onClick={onClose} fullWidth>
          {tier === "FREE" ? "Maybe later" : "Keep browsing"}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}

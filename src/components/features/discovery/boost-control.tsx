"use client";

import { useEffect, useState } from "react";
import { boostMe, type ActionFailure } from "@/actions/discovery";
import { formatDuration } from "@/lib/time";
import type { BoostDto } from "@/server/discovery/deck";
import { IconButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/dialog";
import { BoltIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/*
 * Profile Boost control in the Discover header (docs/ARCHITECTURE.md §12.8). Plus: confirm, then boostMe(); while a
 * boost runs the control shows the time left. Free: the lock sheet. The server decides eligibility and allowance; a
 * direct call from a Free client is refused there. Copy never claims a multiplier: "Get seen sooner".
 */
export function BoostControl({ boost, tier, serverTime, onSync, onBoosted, onLocked }: { boost: BoostDto; tier: "FREE" | "PLUS"; serverTime: () => number; onSync: (iso: string) => void; onBoosted: (next: BoostDto) => void; onLocked: () => void }) {
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const activeMs = boost.activeEndsAt ? Date.parse(boost.activeEndsAt) - serverTime() : 0;
  const active = activeMs > 0;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  const activate = async () => {
    setBusy(true);
    const r = await boostMe().catch((): ActionFailure => ({ ok: false, code: "ERROR", message: "", serverNow: new Date().toISOString() }));
    setBusy(false);
    setConfirmOpen(false);
    if (!r.ok) {
      onSync(r.serverNow);
      if (r.code === "ENTITLEMENT") onLocked();
      else toast.show(r.message || "Couldn't start a Boost right now.");
      return;
    }
    onBoosted({ ...boost, activeEndsAt: r.endsAt, remaining: r.boostsRemaining });
    toast.show("Boost on · you're first in Discover for 30 minutes");
  };

  if (active) {
    // Compact "Nm" in the header (the full countdown is the accessible name); a 375 px header has no room for seconds.
    const minutesLeft = Math.max(1, Math.ceil(activeMs / 60_000));
    return (
      <span className="inline-flex h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-accent px-2.5 text-caption font-bold text-on-accent tabular-nums" role="status" aria-live="polite" aria-label={`Boost active, ${formatDuration(activeMs)} left`}>
        <BoltIcon size={14} /> {minutesLeft}m
      </span>
    );
  }
  return (
    <>
      <IconButton aria-label={tier === "PLUS" ? `Boost your profile, ${boost.remaining} of ${boost.limit} left this week` : "Boost your profile (Mellocrush Plus)"} onClick={() => (tier === "PLUS" ? setConfirmOpen(true) : onLocked())}>
        <BoltIcon size={20} />
      </IconButton>
      <ConfirmationDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void activate()}
        loading={busy}
        title="Boost your profile?"
        description={boost.remaining > 0 ? `Get seen sooner: your profile goes first in Discover for 30 minutes, for the people your filters already allow. You have ${boost.remaining} of ${boost.limit} Boosts left this week.` : `You've used your ${boost.limit} Boosts for this week${boost.resetsAt ? `; the next one is available ${new Date(boost.resetsAt).toLocaleString("en-GB", { timeZone: "Indian/Maldives", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}.`}
        confirmLabel={boost.remaining > 0 ? "Boost for 30 minutes" : "OK"}
      />
    </>
  );
}

"use client";

import { useState } from "react";
import { setFollow } from "@/actions/community";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { call } from "./call";

/**
 * Follow / Following, for one member (spec §9).
 *
 * Private both ways: it shows the VIEWER's own state, the member is never told, and there is no follower count
 * anywhere in this component or the DTO behind it (src/server/community/follows.ts explains why). That is also why
 * the label is "Following" and not "Followers 128" — a number here would be the "public follower-count obsession"
 * the brief rules out.
 *
 * Optimistic, with the previous state restored on failure; the server is idempotent in both directions, so a
 * double tap cannot leave the two out of step.
 */
export function FollowButton({ handle, following, onChange, className }: { handle: string; following: boolean; onChange?: (following: boolean) => void; className?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!handle) return null;

  const toggle = async () => {
    if (busy) return;
    const next = !following;
    setBusy(true);
    onChange?.(next);
    const r = await call(() => setFollow({ handle, following: next }));
    setBusy(false);
    if (!r.ok) {
      onChange?.(!next);
      toast.show(r.code === "NOT_FOUND" ? "This profile isn't available." : r.message);
      return;
    }
    onChange?.(r.following);
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={following}
      className={cn(
        "h-7.5 shrink-0 whitespace-nowrap rounded-full border-0 px-2.5 text-caption font-medium transition-colors duration-150 disabled:opacity-60",
        following ? "bg-surface-muted text-text-secondary" : "bg-aqua-soft text-primary-ink",
        className,
      )}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

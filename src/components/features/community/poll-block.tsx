"use client";

import { useState } from "react";
import { voteOnPoll } from "@/actions/community";
import { cn } from "@/lib/cn";
import { CheckIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { PollDto } from "@/server/community/polls";
import { call } from "./call";

/**
 * A poll inside a post card (spec §3).
 *
 * Results are always visible, before and after voting. Hiding them until you vote turns a question into a toll
 * gate and makes people tap an option they do not mean just to see the answer — which then corrupts the very
 * number they wanted. Tapping an option casts or moves the viewer's vote; the server does both in one transaction,
 * so the bars can never show a total that disagrees with the rows behind it.
 *
 * What is never shown, here or anywhere: who voted for what. The DTO carries totals and the viewer's own choice
 * and nothing else.
 */
export function PollBlock({ postId, poll, onVoted }: { postId: string; poll: PollDto; onVoted: (poll: PollDto) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const vote = async (optionId: string) => {
    if (busy || poll.myOptionId === optionId) return;
    setBusy(true);
    const r = await call(() => voteOnPoll({ postId, optionId }));
    setBusy(false);
    if (!r.ok) {
      toast.show(r.code === "NOT_FOUND" ? "That poll is no longer available." : r.message);
      return;
    }
    onVoted(r.poll);
  };

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Poll">
      {poll.options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={busy}
          onClick={() => void vote(option.id)}
          aria-pressed={option.chosenByMe}
          aria-label={`${option.label} — ${option.percent}%, ${option.votes} ${option.votes === 1 ? "vote" : "votes"}`}
          className={cn(
            "relative flex h-9.5 w-full items-center overflow-hidden rounded-lg border-0 bg-surface-muted px-3 text-left disabled:opacity-70",
            option.chosenByMe && "ring-1 ring-primary/45",
          )}
        >
          {/* The bar is decoration over the track; the numbers beside it are what is actually announced. */}
          <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-aqua-soft transition-[width] duration-300" style={{ width: `${option.percent}%` }} />
          <span className="relative flex min-w-0 flex-1 items-center gap-1.5">
            {option.chosenByMe ? <CheckIcon size={14} className="shrink-0 text-primary" /> : null}
            <span className="truncate text-body-sm text-text">{option.label}</span>
          </span>
          <span className="relative ml-2 shrink-0 text-caption font-medium tabular-nums text-text-secondary">{option.percent}%</span>
        </button>
      ))}
      <p className="text-caption-sm text-text-secondary" aria-live="polite">
        {poll.totalVotes === 0 ? "No votes yet — be the first." : `${poll.totalVotes} ${poll.totalVotes === 1 ? "vote" : "votes"}`}
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EyeOffIcon, FilterIcon, HeartIcon, ImageIcon, WavesIcon } from "@/components/ui/icons";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatDuration } from "@/lib/time";

/*
 * The intentional deck states (Phase 6 §24). They are different situations and say different things:
 *  - exhausted: nobody new right now (prototype copy)
 *  - filters: relaxing the viewer's own filters would show people
 *  - review: people are waiting on photo moderation, so the deck refills on its own — never a count, never a name
 *  - error: the load failed (network / server), retryable
 *  - limit: likes used up — the deck stays browsable, this is only shown when there is also nothing to browse
 */
export function DeckExhausted({ onAdjustFilters, onRefresh }: { onAdjustFilters: () => void; onRefresh: () => void }) {
  return (
    <EmptyState
      framed
      className="h-full"
      icon={<WavesIcon strokeWidth={2} />}
      title="That's everyone for now."
      description="Check back later or adjust your preferences."
      actions={
        <>
          <Button variant="secondary" size="md" onClick={onAdjustFilters}>Adjust filters</Button>
          <Button size="md" onClick={onRefresh}>Check again</Button>
        </>
      }
    />
  );
}

export function DeckFiltered({ onAdjustFilters }: { onAdjustFilters: () => void }) {
  return (
    <EmptyState
      framed
      className="h-full"
      icon={<FilterIcon strokeWidth={2} />}
      title="Your filters are hiding everyone."
      description="There are people who match you. Widen your age range or location to see them."
      actions={<Button size="md" onClick={onAdjustFilters}>Adjust filters</Button>}
    />
  );
}

/**
 * Empty only because profiles are waiting for photo moderation. It says the deck will refill without the viewer
 * doing anything, and deliberately carries no number and nothing about who is waiting.
 */
export function DeckAwaitingReview({ onRefresh }: { onRefresh: () => void }) {
  return (
    <EmptyState
      framed
      className="h-full"
      icon={<ImageIcon strokeWidth={2} />}
      title="New profiles are being checked."
      description="Every photo is reviewed before it goes live. More people will appear here shortly."
      actions={<Button size="md" onClick={onRefresh}>Check again</Button>}
    />
  );
}

export function DeckError({ onRetry }: { onRetry: () => void }) {
  return <ErrorState className="h-full rounded-card bg-surface-muted" title="Couldn't load Discover" description="Mellocrush couldn't reach the server. Check your connection and try again." onRetry={onRetry} />;
}

export function DeckLoading() {
  return <div className="h-full rounded-card bg-aqua-soft motion-ok:animate-shimmer" aria-busy="true" aria-label="Loading profiles" />;
}

export function LikesExhaustedNote({ limit, msUntilReset }: { limit: number; msUntilReset: number | null }) {
  return (
    <EmptyState
      framed
      className="h-full"
      icon={<HeartIcon />}
      title={`You've used today's ${limit} likes.`}
      description={msUntilReset != null ? `Your likes refresh in ${formatDuration(msUntilReset)}. You can keep browsing and passing.` : "You can keep browsing and passing."}
    />
  );
}

/** Pause Dating (Privacy & Safety → Hidden): the viewer is hidden from Discover and gets no deck until they resume. */
export function DeckPaused() {
  return (
    <EmptyState
      framed
      className="h-full"
      icon={<EyeOffIcon strokeWidth={2} />}
      title="Dating is paused."
      description="You're hidden from Discover and won't see new people. Your matches and chats keep working."
      actions={<Link href="/settings/privacy" className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-body-sm font-bold text-on-primary">Resume in Privacy &amp; Safety</Link>}
    />
  );
}

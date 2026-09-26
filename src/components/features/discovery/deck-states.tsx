"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CloseIcon, EyeOffIcon, FilterIcon, HeartIcon, ImageIcon, WavesIcon } from "@/components/ui/icons";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatDuration } from "@/lib/time";

/*
 * The intentional deck states (Phase 6 §24). They are different situations and say different things:
 *  - exhausted: the viewer has already acted on everybody compatible — "seen everyone" is said only when it is true
 *  - unavailable: nobody compatible is here right now at all. Neutral on purpose: the cause can be other members'
 *    preferences (their age range, their pool), and those are never the viewer's to learn
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
      title="You've seen everyone for now."
      description="New people join all the time. Check back later, or widen your filters to see more."
      actions={
        <>
          <Button variant="secondary" size="md" onClick={onAdjustFilters}>Adjust filters</Button>
          <Button size="md" onClick={onRefresh}>Check again</Button>
        </>
      }
    />
  );
}

/** Nobody compatible is here right now. Says nothing about why, and never names a count or a person. */
export function DeckUnavailable({ onAdjustFilters, onRefresh }: { onAdjustFilters: () => void; onRefresh: () => void }) {
  return (
    <EmptyState
      framed
      className="h-full"
      icon={<WavesIcon strokeWidth={2} />}
      title="No one new is here right now."
      description="Mellocrush is growing island by island. Check back soon — new members appear here as they join."
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
      description="There are people here for the same thing as you. Widen your age range, location or other filters to see them."
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
  return <ErrorState className="h-full rounded-card bg-surface-muted" title="Couldn't load Discover" description="MelloCrush couldn't reach the server. Check your connection and try again." onRetry={onRetry} />;
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
      actions={<Link href="/settings/privacy" className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-body-sm font-medium text-on-primary">Resume in Privacy &amp; Safety</Link>}
    />
  );
}

/**
 * The Discover Likes You prompt — Option A (docs/ARCHITECTURE.md §12.19): shown ONLY inside an empty or out-of-likes
 * deck state, never over, beside or near a live card, so it cannot touch a swipe or the swipe lesson.
 *
 * `count` is the server's eligible-likes count for a Free member, and the owner renders this only when it is at least
 * one; Plus members are never sent a count. It leads to Likes You — the real, blurred tiles — not straight to a price,
 * carrying `?from=discover_likes` so a purchase that follows is still credited to this prompt.
 * Dismissing it hides it for the rest of the browser session.
 */
export function LikesYouPrompt({ count, onOpen, onDismiss }: { count: number; onOpen: () => void; onDismiss: () => void }) {
  return (
    <div className="relative flex items-center gap-3 rounded-2xl glass-card px-4 py-3" role="region" aria-label="People who like you">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-aqua-soft text-primary-ink" aria-hidden="true"><HeartIcon size={18} filled strokeWidth={0} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium text-text">{count === 1 ? "Someone likes you" : `${count} people like you`}</div>
        <div className="text-caption text-text-secondary">See who&apos;s interested with MelloCrush Plus.</div>
      </div>
      <Link href="/likes?from=discover_likes" onClick={onOpen} className="inline-flex h-9 shrink-0 items-center rounded-lg bg-primary px-3 text-caption font-medium text-on-primary pressable">See who</Link>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="grid size-9 shrink-0 place-items-center rounded-full border-0 bg-transparent text-text-secondary">
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

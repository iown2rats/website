"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { SwipeIcon } from "@/components/ui/icons";
import { ProfileCard } from "./profile-card";
import { SwipeControls } from "./swipe-controls";
import { stampOpacity, useSwipeGuide } from "./swipe-guide";
import type { CardProfile } from "./types";

/*
 * Card-stack interaction, ported from the prototype logic:
 *  - drag follows the pointer with no transition; rotate dx/18°, vertical damped ×0.5
 *  - release: > 110 px → like, < −110 px → pass, dy < −120 → open profile, else spring back (320 ms ease-out-soft)
 *  - tap (< 8 px): left 30 % previous photo, right 30 % next photo, centre open profile
 *  - LIKE / PASS stamps fade in over the first 90 px (`stampOpacity`, ./swipe-guide); next card scales .95 → 1 over 150 px
 *  - exit: 600 px sideways, −40 px lift, 320 ms, then commit
 *  - keyboard: ← pass, → like, ↑ open (deck focused); buttons always available
 *  - reduced motion: no exit animation, instant commit
 * The deck is head-driven: `profiles[0]` is the current card. On commit it reports the decision and the owner
 * removes the head (and reconciles with the server); the deck itself holds no swipe history.
 *
 * How it stays smooth (and opaque):
 *  - Movement never goes through React. Pointer moves are coalesced to one write per animation frame, and `paint()`
 *    writes the transform (translate3d/rotate, compositor-only), the next card's scale and the stamps' opacity
 *    (as CSS variables the card reads) straight to the DOM. A drag re-renders nothing; release and exit render once.
 *  - Transitions are switched off for the whole of a drag and on only for spring-back and exit, on both cards, so
 *    no transition ever chases a per-frame value.
 *  - The next card is the real card, fully rendered underneath under its own key, with its photo loading eagerly.
 *    Promotion is the same DOM node changing role — the photo is already fetched and decoded, nothing remounts —
 *    and the profile after it has its main photo warmed in the cache. Both cards are opaque (see ProfileCard), so
 *    the top card can never show the one beneath, whatever state its photo is in.
 */
export interface SwipeDeckProps {
  profiles: CardProfile[];
  onLike: (profile: CardProfile) => void;
  onPass: (profile: CardProfile) => void;
  onOpen?: (profile: CardProfile) => void;
  /** Super Like the current card (§12.20). */
  onSuperLike?: (profile: CardProfile) => void;
  /** Draw the star locked (PLUS tag): Free or lapsed Plus. The tap still reaches `onSuperLike`, which explains Plus. */
  superLikeLocked?: boolean;
  /** Rendered as the far-left control when provided (Plus). */
  onUndo?: () => void;
  undoDisabled?: boolean;
  /** Draw Undo with a Plus tag: a tap still goes to the server, which explains Plus if it refuses. */
  undoLocked?: boolean;
  /** Shown when there is no current card. */
  empty?: ReactNode;
  showPlaceholderLabels?: boolean;
  /** Disables the controls (e.g. while a limit dialog is open). */
  disabled?: boolean;
  /** Announced to screen readers after the card summary. */
  remainingHint?: string;
  /**
   * Run the first-visit swipe lesson on the first card (Discover only, once per viewer — see ./swipe-guide).
   * Off by default so the showcase and any future deck never animate on their own.
   */
  guide?: boolean;
  className?: string;
}

/** Horizontal travel that commits a swipe. Exported so the first-visit lesson can be proven to stay under it. */
export const SWIPE_X = 110;
const SWIPE_UP = 120;
const TAP = 8;
const NEXT_SCALE_RANGE = 150;
const NEXT_MIN_SCALE = 0.95;
const EXIT_MS = 320;
const EXIT_X = 600;
const EXIT_Y = -40;
/** Delay before warming photos the member has not reached yet, so it never competes with the card on screen. */
const PRELOAD_DELAY_MS = 250;

/** Scale of the card underneath for a given horizontal travel of the top card. */
export function nextCardScale(dx: number): number {
  return NEXT_MIN_SCALE + (Math.min(Math.abs(dx), NEXT_SCALE_RANGE) / NEXT_SCALE_RANGE) * (1 - NEXT_MIN_SCALE);
}

/** The top card's transform: compositor-only properties, and none at all at rest. */
export function cardTransform(dx: number, dy: number): string {
  return dx === 0 && dy === 0 ? "" : `translate3d(${dx}px, ${dy}px, 0) rotate(${dx / 18}deg)`;
}

/**
 * The photos worth fetching ahead, and no more: the current member's other photos (a tap away) and the main photo
 * of the member after the next one (the next card's own photo is already loading, because it is rendered). Locked
 * photos have no url and are never included. Never the rest of the queue.
 */
export function photosToPreload(current: CardProfile | null, after: CardProfile | null): string[] {
  const urls: string[] = [];
  for (const p of current?.photos.slice(1) ?? []) if (!p.locked && p.url) urls.push(p.url);
  const main = after?.photos[0];
  if (main && !main.locked && main.url) urls.push(main.url);
  return urls;
}

// The deck re-renders on release, on exit and on promotion; the cards themselves only when their own props change.
const DeckCard = memo(ProfileCard);

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
}

export function SwipeDeck({ profiles, onLike, onPass, onOpen, onSuperLike, superLikeLocked = false, onUndo, undoDisabled = false, undoLocked = false, empty, showPlaceholderLabels = false, disabled = false, remainingHint, guide = false, className }: SwipeDeckProps) {
  const reducedMotion = useReducedMotion();
  const [photo, setPhoto] = useState<{ id: string; idx: number } | null>(null);
  const [exiting, setExiting] = useState<"like" | "pass" | null>(null);
  // Bumped on every commit so the deck always renders once afterwards, even when the owner keeps the card.
  const [commits, setCommits] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLDivElement>(null);
  /** The live gesture: where the finger went down and how far the card has travelled since. Never React state. */
  const gesture = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const frame = useRef<number | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef<string | null>(null);
  const lessonWasActive = useRef(false);

  const current = profiles[0] ?? null;
  const next = profiles[1] ?? null;
  const after = profiles[2] ?? null;
  const photoIdx = current && photo?.id === current.id ? photo.idx : 0;

  // Presentation only. These numbers reach the transform and the stamps; they never reach `swipe()` or `commit()`.
  const lesson = useSwipeGuide(guide && current != null && !disabled, reducedMotion);
  const cancelLesson = lesson.cancel;

  /** The one place a card moves. `animate` is spring-back and exit; everything else follows the finger exactly. */
  const paint = useCallback((dx: number, dy: number, opts: { animate?: boolean; like?: number; pass?: number } = {}) => {
    const transition = opts.animate ? "transform var(--duration-card) var(--ease-out-soft)" : "none";
    const card = cardRef.current;
    if (card) {
      card.style.transition = transition;
      card.style.transform = cardTransform(dx, dy);
      card.style.setProperty("--like-stamp", String(opts.like ?? stampOpacity(dx, "like")));
      card.style.setProperty("--pass-stamp", String(opts.pass ?? stampOpacity(dx, "pass")));
      card.style.setProperty("--stamp-fade", opts.animate ? "100ms" : "0ms");
    }
    const below = nextRef.current;
    if (below) {
      below.style.transition = transition;
      below.style.transform = `scale(${nextCardScale(dx)})`;
    }
  }, []);

  // A card arriving on top (promoted from underneath, restored by Undo, or the first one) starts flat and centred.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transition = "none";
    card.style.transform = "";
    card.style.setProperty("--like-stamp", "0");
    card.style.setProperty("--pass-stamp", "0");
  }, [current?.id]);
  // A card arriving underneath waits at the resting scale.
  useLayoutEffect(() => {
    const below = nextRef.current;
    if (!below) return;
    below.style.transition = "none";
    below.style.transform = `scale(${NEXT_MIN_SCALE})`;
  }, [next?.id]);

  // The lesson drives the same paint path, frame by frame, until it ends or a finger takes over.
  useLayoutEffect(() => {
    if (lesson.active) paint(lesson.dx, 0, { like: lesson.like, pass: lesson.pass });
    // Ended on its own: settle back. Cancelled by a touch: snap to rest, so the drag starts from the finger.
    else if (lessonWasActive.current && !exitTimer.current) paint(0, 0, { animate: gesture.current == null });
    lessonWasActive.current = lesson.active;
  }, [lesson.active, lesson.dx, lesson.like, lesson.pass, paint]);

  // After a commit the owner normally removes the card. If it kept it (the like-limit dialog), bring it back.
  useLayoutEffect(() => {
    const id = committed.current;
    if (id == null) return;
    committed.current = null;
    if (current?.id === id) paint(0, 0, { animate: true });
  }, [commits, current?.id, paint]);

  // Warm the photos a member reaches next — conservatively, see `photosToPreload`.
  const preload = photosToPreload(current, after).join("\n");
  useEffect(() => {
    if (!preload) return;
    const id = setTimeout(() => {
      for (const url of preload.split("\n")) {
        const img = new Image();
        img.decoding = "async";
        img.src = url;
      }
    }, PRELOAD_DELAY_MS);
    return () => clearTimeout(id);
  }, [preload]);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  const commit = useCallback(
    (kind: "like" | "pass", profile: CardProfile) => {
      exitTimer.current = null;
      committed.current = profile.id;
      setExiting(null);
      setCommits((n) => n + 1);
      if (kind === "like") onLike(profile);
      else onPass(profile);
    },
    [onLike, onPass],
  );

  const swipe = useCallback(
    (kind: "like" | "pass") => {
      // Also reached from the buttons, so the lesson ends here too rather than only on the card.
      cancelLesson();
      if (!current || exiting || disabled) return;
      if (reducedMotion) {
        commit(kind, current);
        return;
      }
      setExiting(kind);
      paint(kind === "like" ? EXIT_X : -EXIT_X, EXIT_Y, { animate: true });
      exitTimer.current = setTimeout(() => commit(kind, current), EXIT_MS);
    },
    [cancelLesson, commit, current, disabled, exiting, paint, reducedMotion],
  );

  const open = useCallback(() => {
    cancelLesson();
    if (current && !disabled) onOpen?.(current);
  }, [cancelLesson, current, disabled, onOpen]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The lesson yields on touch, before anything else happens, so the first pixel of a drag is already the
    // member's own. It never fights a gesture: cancelling drops `lesson.active`, and the card snaps to rest.
    cancelLesson();
    if (exiting || disabled) return;
    gesture.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || exiting) return;
    g.dx = e.clientX - g.x;
    g.dy = (e.clientY - g.y) * 0.5;
    // Many pointer events can arrive per frame; only the latest position is ever painted.
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const live = gesture.current;
      if (live) paint(live.dx, live.dy);
    });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const mdx = e.clientX - g.x;
    const mdy = e.clientY - g.y;
    if (Math.abs(mdx) < TAP && Math.abs(mdy) < TAP) {
      const r = e.currentTarget.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      paint(0, 0);
      if (current && current.photos.length > 1 && fx < 0.3) setPhoto({ id: current.id, idx: (photoIdx - 1 + current.photos.length) % current.photos.length });
      else if (current && current.photos.length > 1 && fx > 0.7) setPhoto({ id: current.id, idx: (photoIdx + 1) % current.photos.length });
      else open();
      return;
    }
    if (mdx > SWIPE_X) swipe("like");
    else if (mdx < -SWIPE_X) swipe("pass");
    else {
      paint(0, 0, { animate: true });
      if (mdy < -SWIPE_UP) open();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    cancelLesson();
    if (e.key === "ArrowRight") { e.preventDefault(); swipe("like"); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); swipe("pass"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); open(); }
  };

  if (!current) {
    return <div className={cn("absolute inset-0 bottom-20", className)}>{empty}</div>;
  }

  return (
    <div className={cn("absolute inset-0", className)}>
      {/*
        * The two cards are siblings under their own keys, the one underneath first. When the top card goes, the one
        * beneath keeps its key, its DOM and its decoded photo and simply becomes the top card; only the card newly
        * dealt underneath mounts. The card underneath is inert and hidden from assistive tech: it is scenery.
        */}
      {next ? (
        <div key={next.id} ref={nextRef} aria-hidden="true" inert className="pointer-events-none absolute inset-0 bottom-20 will-change-transform">
          <DeckCard profile={next} photoIndex={0} fill loading="eager" showPlaceholderLabel={showPlaceholderLabels} />
        </div>
      ) : null}

      <div
        key={current.id}
        ref={cardRef}
        role="group"
        aria-label={`Profile card: ${current.name}${current.age != null ? `, ${current.age}` : ""}. Right arrow to like, left arrow to pass, up arrow to view.`}
        aria-roledescription="swipeable card"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="absolute inset-0 bottom-20 cursor-grab touch-none will-change-transform active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-card"
      >
        <DeckCard profile={current} photoIndex={photoIdx} fill loading="eager" fetchPriority="high" showPlaceholderLabel={showPlaceholderLabels} />
      </div>

      {guide ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-20 flex h-0 items-center justify-center transition-opacity duration-300 ease-soft"
          style={{ opacity: lesson.hint ? 1 : 0 }}
        >
          {/* Blurred only while shown: a backdrop-filter over the deck is recomputed on every frame the card moves. */}
          <span className={cn("flex items-center gap-2 rounded-full bg-glass-strong px-3.5 py-2 text-caption text-text-secondary shadow-sm", lesson.hint && "backdrop-blur-sm")}>
            <SwipeIcon size={16} strokeWidth={1.9} />
            Swipe to discover
          </span>
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-1">
        <SwipeControls
          onPass={() => swipe("pass")}
          onLike={() => swipe("like")}
          onOpen={onOpen ? open : undefined}
          onSuperLike={onSuperLike ? () => onSuperLike(current) : undefined}
          superLikeLocked={superLikeLocked}
          onUndo={onUndo}
          undoDisabled={undoDisabled}
          undoLocked={undoLocked}
          disabled={Boolean(exiting) || disabled}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {current.name}{current.age != null ? `, ${current.age}` : ""}. {remainingHint ?? `${Math.max(0, profiles.length - 1)} more profiles loaded.`}
      </p>
    </div>
  );
}

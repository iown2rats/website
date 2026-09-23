"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { photoBackground } from "@/lib/photos";
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
 */
export interface SwipeDeckProps {
  profiles: CardProfile[];
  onLike: (profile: CardProfile) => void;
  onPass: (profile: CardProfile) => void;
  onOpen?: (profile: CardProfile) => void;
  onIntro?: (profile: CardProfile) => void;
  /** Rendered as the far-left control when provided (Plus). */
  onUndo?: () => void;
  undoDisabled?: boolean;
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
const EXIT_MS = 320;

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
}

export function SwipeDeck({ profiles, onLike, onPass, onOpen, onIntro, onUndo, undoDisabled = false, empty, showPlaceholderLabels = false, disabled = false, remainingHint, guide = false, className }: SwipeDeckProps) {
  const reducedMotion = useReducedMotion();
  const [photo, setPhoto] = useState<{ id: string; idx: number } | null>(null);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [exiting, setExiting] = useState<"like" | "pass" | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = profiles[0] ?? null;
  const next = profiles[1] ?? null;
  const photoIdx = current && photo?.id === current.id ? photo.idx : 0;

  // Presentation only. These numbers reach the transform and the stamps; they never reach `swipe()` or `commit()`.
  const lesson = useSwipeGuide(guide && current != null && !disabled, reducedMotion);
  const cancelLesson = lesson.cancel;

  useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current); }, []);

  const commit = useCallback(
    (kind: "like" | "pass", profile: CardProfile) => {
      setExiting(null);
      setDrag({ dx: 0, dy: 0, dragging: false });
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
      setDrag({ dx: kind === "like" ? 600 : -600, dy: -40, dragging: false });
      exitTimer.current = setTimeout(() => commit(kind, current), EXIT_MS);
    },
    [cancelLesson, commit, current, disabled, exiting, reducedMotion],
  );

  const open = useCallback(() => {
    cancelLesson();
    if (current && !disabled) onOpen?.(current);
  }, [cancelLesson, current, disabled, onOpen]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The lesson yields on touch, before anything else happens, so the first pixel of a drag is already the
    // member's own. It never fights a gesture: cancelling drops `lesson.active`, and the next render reads `drag`.
    cancelLesson();
    if (exiting || disabled) return;
    start.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag((d) => ({ ...d, dragging: true }));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current || exiting) return;
    setDrag({ dx: e.clientX - start.current.x, dy: (e.clientY - start.current.y) * 0.5, dragging: true });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const mdx = e.clientX - start.current.x;
    const mdy = e.clientY - start.current.y;
    start.current = null;
    if (Math.abs(mdx) < TAP && Math.abs(mdy) < TAP) {
      const r = e.currentTarget.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      setDrag({ dx: 0, dy: 0, dragging: false });
      if (current && current.photos.length > 1 && fx < 0.3) setPhoto({ id: current.id, idx: (photoIdx - 1 + current.photos.length) % current.photos.length });
      else if (current && current.photos.length > 1 && fx > 0.7) setPhoto({ id: current.id, idx: (photoIdx + 1) % current.photos.length });
      else open();
      return;
    }
    if (mdx > SWIPE_X) swipe("like");
    else if (mdx < -SWIPE_X) swipe("pass");
    else {
      setDrag({ dx: 0, dy: 0, dragging: false });
      if (mdy < -SWIPE_UP) open();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    cancelLesson();
    if (e.key === "ArrowRight") { e.preventDefault(); swipe("like"); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); swipe("pass"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); open(); }
  };

  const { dy, dragging } = drag;
  // While the lesson runs it supplies the card's x and the stamps; the instant it is cancelled the member's own
  // drag takes over on the same variables, which is why there is only ever one card position in play.
  const dx = lesson.active ? lesson.dx : drag.dx;
  const likeOpacity = lesson.active ? lesson.like : stampOpacity(drag.dx, "like");
  const passOpacity = lesson.active ? lesson.pass : stampOpacity(drag.dx, "pass");
  const nextScale = 0.95 + (Math.min(Math.abs(dx), NEXT_SCALE_RANGE) / NEXT_SCALE_RANGE) * 0.05;
  // The lesson drives every frame itself, so it needs the transition off for the same reason a drag does.
  const cardTransition = (dragging || lesson.active) && !exiting ? "none" : `transform var(--duration-card) var(--ease-out-soft)`;

  if (!current) {
    return <div className={cn("absolute inset-0 bottom-20", className)}>{empty}</div>;
  }

  return (
    <div className={cn("absolute inset-0", className)}>
      {next ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 bottom-20 overflow-hidden rounded-card bg-aqua-soft shadow-sm transition-transform duration-300 ease-soft"
          style={{ transform: `scale(${nextScale})`, ...photoBackground(next.photos[0] ?? null, 160, "thumb") }}
        >
          <div className="absolute inset-x-0 bottom-0 h-[45%] photo-scrim" />
        </div>
      ) : null}

      <div
        key={current.id}
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
        style={{ transform: `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`, transition: cardTransition }}
      >
        <ProfileCard profile={current} photoIndex={photoIdx} likeOpacity={likeOpacity} passOpacity={passOpacity} fill showPlaceholderLabel={showPlaceholderLabels} />
      </div>

      {guide ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-20 flex h-0 items-center justify-center transition-opacity duration-300 ease-soft"
          style={{ opacity: lesson.hint ? 1 : 0 }}
        >
          <span className="flex items-center gap-2 rounded-full bg-glass-strong px-3.5 py-2 text-caption text-text-secondary shadow-sm backdrop-blur-sm">
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
          onIntro={onIntro ? () => onIntro(current) : undefined}
          onUndo={onUndo}
          undoDisabled={undoDisabled}
          disabled={Boolean(exiting) || disabled}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {current.name}{current.age != null ? `, ${current.age}` : ""}. {remainingHint ?? `${Math.max(0, profiles.length - 1)} more profiles loaded.`}
      </p>
    </div>
  );
}

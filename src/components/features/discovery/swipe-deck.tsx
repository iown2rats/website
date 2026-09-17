"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { photoBackground } from "@/lib/photos";
import { ProfileCard } from "./profile-card";
import { SwipeControls } from "./swipe-controls";
import type { CardProfile } from "./types";

/*
 * Card-stack interaction, ported from the prototype logic:
 *  - drag follows the pointer with no transition; rotate dx/18°, vertical damped ×0.5
 *  - release: > 110 px → like, < −110 px → pass, dy < −120 → open profile, else spring back (320 ms ease-out-soft)
 *  - tap (< 8 px): left 30 % previous photo, right 30 % next photo, centre open profile
 *  - LIKE / PASS stamps fade in over the first 90 px; next card scales .95 → 1 over 150 px
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
  className?: string;
}

const SWIPE_X = 110;
const SWIPE_UP = 120;
const TAP = 8;
const STAMP_RANGE = 90;
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

export function SwipeDeck({ profiles, onLike, onPass, onOpen, onIntro, onUndo, undoDisabled = false, empty, showPlaceholderLabels = false, disabled = false, remainingHint, className }: SwipeDeckProps) {
  const reducedMotion = useReducedMotion();
  const [photo, setPhoto] = useState<{ id: string; idx: number } | null>(null);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [exiting, setExiting] = useState<"like" | "pass" | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = profiles[0] ?? null;
  const next = profiles[1] ?? null;
  const photoIdx = current && photo?.id === current.id ? photo.idx : 0;

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
      if (!current || exiting || disabled) return;
      if (reducedMotion) {
        commit(kind, current);
        return;
      }
      setExiting(kind);
      setDrag({ dx: kind === "like" ? 600 : -600, dy: -40, dragging: false });
      exitTimer.current = setTimeout(() => commit(kind, current), EXIT_MS);
    },
    [commit, current, disabled, exiting, reducedMotion],
  );

  const open = useCallback(() => {
    if (current && !disabled) onOpen?.(current);
  }, [current, disabled, onOpen]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
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
    if (e.key === "ArrowRight") { e.preventDefault(); swipe("like"); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); swipe("pass"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); open(); }
  };

  const { dx, dy, dragging } = drag;
  const likeOpacity = Math.max(0, Math.min(1, dx / STAMP_RANGE));
  const passOpacity = Math.max(0, Math.min(1, -dx / STAMP_RANGE));
  const nextScale = 0.95 + (Math.min(Math.abs(dx), NEXT_SCALE_RANGE) / NEXT_SCALE_RANGE) * 0.05;
  const cardTransition = dragging && !exiting ? "none" : `transform var(--duration-card) var(--ease-out-soft)`;

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

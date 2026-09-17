"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { photoBackground } from "@/lib/photos";
import { Button } from "@/components/ui/button";
import { WavesIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
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
 * Phase 4: callbacks only; database mutations are wired in Phase 6/7.
 */
export interface SwipeDeckProps {
  profiles: CardProfile[];
  onLike?: (profile: CardProfile) => void;
  onPass?: (profile: CardProfile) => void;
  onOpen?: (profile: CardProfile) => void;
  onIntro?: (profile: CardProfile) => void;
  onUndo?: () => void;
  onAdjustFilters?: () => void;
  onReset?: () => void;
  showPlaceholderLabels?: boolean;
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

export function SwipeDeck({ profiles, onLike, onPass, onOpen, onIntro, onUndo, onAdjustFilters, onReset, showPlaceholderLabels = false, className }: SwipeDeckProps) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [exiting, setExiting] = useState<"like" | "pass" | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = profiles[index] ?? null;
  const next = profiles[index + 1] ?? null;

  useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current); }, []);

  const commit = useCallback(
    (kind: "like" | "pass") => {
      const profile = profiles[index];
      if (!profile) return;
      if (kind === "like") onLike?.(profile);
      else onPass?.(profile);
      setIndex((i) => i + 1);
      setPhotoIdx(0);
      setExiting(null);
      setDrag({ dx: 0, dy: 0, dragging: false });
    },
    [index, onLike, onPass, profiles],
  );

  const swipe = useCallback(
    (kind: "like" | "pass") => {
      if (!current || exiting) return;
      if (reducedMotion) {
        commit(kind);
        return;
      }
      setExiting(kind);
      setDrag({ dx: kind === "like" ? 600 : -600, dy: -40, dragging: false });
      exitTimer.current = setTimeout(() => commit(kind), EXIT_MS);
    },
    [commit, current, exiting, reducedMotion],
  );

  const open = useCallback(() => {
    if (current) onOpen?.(current);
  }, [current, onOpen]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (exiting) return;
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
      if (current && current.photos.length > 1 && fx < 0.3) setPhotoIdx((i) => (i - 1 + current.photos.length) % current.photos.length);
      else if (current && current.photos.length > 1 && fx > 0.7) setPhotoIdx((i) => (i + 1) % current.photos.length);
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
    return (
      <div className={cn("absolute inset-0 bottom-20", className)}>
        <EmptyState
          framed
          className="h-full"
          icon={<WavesIcon strokeWidth={2} />}
          title="That's everyone for now."
          description="Check back later or adjust your preferences."
          actions={
            <>
              {onAdjustFilters ? <Button variant="secondary" size="md" onClick={onAdjustFilters}>Adjust filters</Button> : null}
              {onReset ? <Button size="md" onClick={() => { onReset(); setIndex(0); }}>Reset demo deck</Button> : null}
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className={cn("absolute inset-0", className)}>
      {next ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 bottom-20 overflow-hidden rounded-card bg-aqua-soft shadow-sm transition-transform duration-300 ease-soft"
          style={{ transform: `scale(${nextScale})`, ...photoBackground(next.photos[0] ?? null, 160) }}
        >
          <div className="absolute inset-x-0 bottom-0 h-[45%] photo-scrim" />
        </div>
      ) : null}

      <div
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
          disabled={Boolean(exiting)}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {current.name}{current.age != null ? `, ${current.age}` : ""}. {profiles.length - index - 1} more profiles.
      </p>
    </div>
  );
}

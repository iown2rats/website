"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * The first-visit swipe lesson (docs/DESIGN_SYSTEM.md §43).
 *
 * It teaches one thing — right is Like, left is Pass — by moving the real card a little way in each direction and
 * letting the card's own LIKE/PASS stamps come up with it. Nothing here is a second swipe system: the deck already
 * owns drag state, thresholds, transforms and the commit path, and this module only produces a stream of
 * presentation values for it to render. It cannot like, pass, match, spend an allowance or advance the deck,
 * because it never calls anything that could — see `SwipeDeck`, where the guide's numbers reach the transform and
 * the stamps and stop there, while `swipe()`/`commit()` remain reachable only from a pointer, a key or a button.
 *
 * Where the flag lives. There is no server-side "UI state" store in Mellocrush, and this is not worth a migration:
 * it is a per-viewer convenience exactly like the appearance choice in `theme-toggle.tsx`, which is why it uses the
 * same mechanism and the same `thundi.` key prefix. A member who clears their storage or arrives on a second device
 * sees the lesson once more, which is the right failure: showing a four-second animation twice costs nothing, and
 * a database column to prevent it would cost a migration on the members table.
 */
const KEY = "thundi.swipeGuideSeen";

/** How far the card leans, in px. Deliberately below the deck's 110 px commit threshold — a lean, not a throw. */
export const GUIDE_PEEK = 84;
/** Matches the deck's STAMP_RANGE, so the demo and a real drag light the stamps by the identical formula. */
const STAMP_RANGE = 90;

/**
 * Stamp opacity from horizontal travel — the one formula, shared by the demo and by every real drag.
 * Linear in distance rather than a threshold flip, so the stamp answers the finger continuously; clamped so a long
 * drag cannot over-drive it; and signed, so only one of the two is ever above zero.
 */
export function stampOpacity(dx: number, direction: "like" | "pass"): number {
  const travel = direction === "like" ? dx : -dx;
  return Math.max(0, Math.min(1, travel / STAMP_RANGE));
}

export interface GuideFrame {
  /** True while the demo is driving the card. The deck renders these values instead of its own drag values. */
  active: boolean;
  dx: number;
  like: number;
  pass: number;
  /** Whether the "Swipe to discover" hint under the card should be visible. */
  hint: boolean;
}

const IDLE: GuideFrame = { active: false, dx: 0, like: 0, pass: 0, hint: false };

/** Legs of the demo: lean right, hold, centre, breathe, lean left, hold, centre. */
const LEGS: { to: number; ms: number }[] = [
  { to: GUIDE_PEEK, ms: 430 },
  { to: GUIDE_PEEK, ms: 320 },
  { to: 0, ms: 430 },
  { to: 0, ms: 240 },
  { to: -GUIDE_PEEK, ms: 430 },
  { to: -GUIDE_PEEK, ms: 320 },
  { to: 0, ms: 430 },
];
const START_DELAY_MS = 750;
/** Reduced motion: the same lesson told without movement — each stamp simply shown, then the other. */
const STILL_LEGS: { like: number; pass: number; ms: number }[] = [
  { like: 1, pass: 0, ms: 1100 },
  { like: 0, pass: 0, ms: 200 },
  { like: 0, pass: 1, ms: 1100 },
];

/** Cubic ease-out, the curve `--ease-out-soft` approximates, so the demo moves like the card's own spring-back. */
const ease = (t: number) => 1 - (1 - t) ** 3;

export function hasSeenSwipeGuide(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Private mode, blocked storage: treat as seen. A lesson that cannot be remembered must not repeat forever.
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable: the lesson simply does not persist for this viewer */
  }
}

/**
 * Runs the lesson once, when `ready` first becomes true and the viewer has not seen it.
 *
 * `cancel()` is the whole interruption contract and the deck calls it on the first sign of a real gesture. It
 * stops the timeline where it stands and returns `active: false` on the very next frame, so the deck is already
 * reading the member's own drag by the time their finger has moved a pixel. The flag is written when the lesson
 * STARTS, not when it ends, so an interrupted or backgrounded run still counts as shown.
 */
export function useSwipeGuide(ready: boolean, reducedMotion: boolean): GuideFrame & { cancel: () => void } {
  const [frame, setFrame] = useState<GuideFrame>(IDLE);
  /*
   * idle → running → done, in a ref rather than state.
   *
   * The phase exists because the flag must be read exactly once per mount, and React invokes effects twice in
   * development. Reading `hasSeenSwipeGuide()` at the top of the effect meant the first invocation wrote the flag
   * and the second found it set, so the lesson never played at all under Strict Mode — and would have played in
   * production only, which is the worst place to discover a difference. Now the flag is consulted only on the
   * transition out of `idle`; a re-invoked effect sees `running` and simply starts the timeline again.
   */
  const phase = useRef<"idle" | "running" | "done">("idle");
  const raf = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (phase.current === "done") return;
    phase.current = "done";
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (timer.current !== null) clearTimeout(timer.current);
    raf.current = null;
    timer.current = null;
    setFrame(IDLE);
  }, []);

  useEffect(() => {
    if (!ready || phase.current === "done") return;
    if (phase.current === "idle") {
      if (hasSeenSwipeGuide()) {
        phase.current = "done";
        return;
      }
      // Written at the start, not the end: an interrupted or backgrounded run still counts as taught.
      markSeen();
      phase.current = "running";
    }
    let disposed = false;
    const stop = () => disposed || phase.current === "done";

    const finish = () => {
      if (stop()) return;
      phase.current = "done";
      setFrame(IDLE);
    };

    if (reducedMotion) {
      let i = 0;
      const step = () => {
        if (stop()) return;
        const leg = STILL_LEGS[i];
        if (!leg) return finish();
        setFrame({ active: true, dx: 0, like: leg.like, pass: leg.pass, hint: true });
        i += 1;
        timer.current = setTimeout(step, leg.ms);
      };
      timer.current = setTimeout(step, START_DELAY_MS);
      return () => { disposed = true; if (timer.current !== null) clearTimeout(timer.current); setFrame(IDLE); };
    }

    let leg = 0;
    let from = 0;
    let legStart = 0;

    const tick = (now: number) => {
      if (stop()) return;
      const spec = LEGS[leg];
      if (!spec) return finish();
      if (legStart === 0) legStart = now;
      const t = Math.min(1, (now - legStart) / spec.ms);
      const dx = from + (spec.to - from) * ease(t);
      setFrame({ active: true, dx, like: stampOpacity(dx, "like"), pass: stampOpacity(dx, "pass"), hint: true });
      if (t >= 1) {
        from = spec.to;
        leg += 1;
        legStart = 0;
      }
      raf.current = requestAnimationFrame(tick);
    };

    timer.current = setTimeout(() => {
      if (stop()) return;
      raf.current = requestAnimationFrame(tick);
    }, START_DELAY_MS);

    return () => {
      disposed = true;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      if (timer.current !== null) clearTimeout(timer.current);
      // Reset rather than leave the last frame standing: without this, a `ready` change mid-lesson (the like-limit
      // dialog opening, say) would strand the card at whatever lean it had reached, with no one left to move it.
      setFrame(IDLE);
    };
  }, [ready, reducedMotion]);

  return { ...frame, cancel };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Long-press, without taking anything away from the page.
 *
 * Three things had to keep working, and each one costs a line here:
 *
 *   SCROLLING. A flick through a conversation starts with a finger down on a bubble. `touch-action` is never
 *   touched, so the browser still owns the gesture, and the pending timer is cancelled the moment the finger
 *   travels past a few pixels or the browser claims the gesture (`pointercancel`). Nothing about this hook can
 *   make a thread feel sticky, because the browser is never asked for permission to scroll.
 *
 *   LINKS AND A MOUSE. Mouse input is ignored outright: `pointerType === "mouse"` returns immediately, so
 *   click-and-hold to select text, drag-select across bubbles, and clicking a link all behave exactly as they did.
 *   Desktop gets its menu from a visible control instead, which is the better affordance there anyway.
 *
 *   THE OS MENU. `contextmenu` is suppressed ONLY on a press this hook actually handled. A press that was too
 *   short, or that turned into a scroll, still gets the platform's own behaviour.
 *
 * The press is reported on `pointerdown` + timer rather than on `pointerup`, so it fires under the finger while it
 * is still down — the Messenger feel — and the caller can position a picker at the point that was pressed.
 */

export interface LongPressOptions {
  /** How long the finger must stay put. 450ms is the platform convention: long enough not to fire on a tap. */
  delay?: number;
  /** How far it may drift first. Beyond this the gesture is a scroll and belongs to the browser. */
  moveTolerance?: number;
}

export interface LongPressPoint {
  x: number;
  y: number;
}

export function useLongPress(onLongPress: (point: LongPressPoint) => void, options: LongPressOptions = {}) {
  const { delay = 450, moveTolerance = 10 } = options;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<LongPressPoint | null>(null);
  const handled = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  // A press interrupted by unmounting (a poll replacing the list, a route change) must not fire afterwards.
  useEffect(() => clear, [clear]);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      clear();
      handled.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      const point = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        handled.current = true;
        onLongPress(point);
      }, delay);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const start = origin.current;
      if (!start || timer.current === null) return;
      if (Math.abs(e.clientX - start.x) > moveTolerance || Math.abs(e.clientY - start.y) > moveTolerance) clear();
    },
    onPointerUp: clear,
    // Fired when the browser takes the gesture over to scroll. Exactly the case that must not open a menu.
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => {
      if (handled.current) e.preventDefault();
    },
  };
}

/*
 * Swipe-right-to-reply.
 *
 * The brief made this conditional — "if it can be implemented reliably without interfering with scrolling" — so
 * it is built to make that interference STRUCTURALLY IMPOSSIBLE rather than merely unlikely:
 *
 *   - `preventDefault` is never called, anywhere in here.
 *   - `touch-action` is never set. The usual trick is `pan-y` on the swipeable element, which hands horizontal
 *     movement to the page; it works, and it also takes pinch-zoom away from that element and makes the browser's
 *     behaviour depend on a CSS property this code cannot verify on a device. Not worth it.
 *   - The gesture must declare itself HORIZONTAL before anything visible happens: past the threshold, and more
 *     than twice as far across as down. A finger heading down the screen is a scroll and is never a swipe.
 *   - `pointercancel` — which is exactly what the browser sends when it takes the gesture over to scroll — aborts
 *     and snaps back.
 *
 * The worst this can do is fail to fire. It cannot hold a scroll, because it never asks to.
 */

export interface SwipeReplyOptions {
  /** How far right the finger must travel before the drag is real. */
  threshold?: number;
  /** Where the bubble stops following the finger, so it never slides across the whole screen. */
  max?: number;
  /** Past this, releasing commits the reply. */
  commit?: number;
}

export function useSwipeToReply(onReply: () => void, enabled: boolean, options: SwipeReplyOptions = {}) {
  const { threshold = 12, max = 64, commit = 44 } = options;
  const origin = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"unknown" | "horizontal" | "vertical">("unknown");
  const [offset, setOffset] = useState(0);

  const reset = useCallback(() => {
    origin.current = null;
    axis.current = "unknown";
    setOffset(0);
  }, []);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled || e.pointerType === "mouse") return;
      origin.current = { x: e.clientX, y: e.clientY };
      axis.current = "unknown";
    },
    onPointerMove: (e: React.PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (axis.current === "unknown") {
        // Undecided until the finger has committed to a direction. Leftwards is not a reply either.
        if (Math.abs(dy) > threshold && Math.abs(dy) >= Math.abs(dx)) {
          axis.current = "vertical";
          origin.current = null;
          return;
        }
        if (dx > threshold && dx > Math.abs(dy) * 2) axis.current = "horizontal";
        else return;
      }
      if (axis.current !== "horizontal") return;
      setOffset(Math.max(0, Math.min(dx, max)));
    },
    onPointerUp: () => {
      const committed = axis.current === "horizontal" && offset >= commit;
      reset();
      if (committed) onReply();
    },
    // The browser claimed the gesture. Snap back and report nothing.
    onPointerCancel: reset,
  };

  // `offset` only leaves zero once the axis has been decided horizontal, so it answers "is a swipe in progress"
  // on its own — and unlike the ref, it is state, which is what a render is allowed to read.
  return { handlers, offset, swiping: offset > 0 };
}

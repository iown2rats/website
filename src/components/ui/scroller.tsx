import type { ComponentPropsWithoutRef, CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * A strip that scrolls sideways inside itself and never makes the page scroll (docs/DESIGN_SYSTEM.md §33).
 *
 * The contract says the document must never scroll horizontally; a chip row or a carousel is the one shape that
 * legitimately needs to. This is where that exception lives, so it is declared rather than improvised — an
 * `overflow-x-auto` written by hand looks identical and carries none of the three things below.
 *
 * What it adds over the class it replaces:
 *
 *   - `overscroll-behavior-x: contain`. Without it, flicking a carousel past its end chains the scroll to the
 *     page on iOS, so the whole app slides sideways under the user's thumb. That reads exactly like an overflow
 *     bug and cannot be reproduced on a desktop mouse, which is why it survived every previous sweep.
 *   - One number for the bleed. Going edge to edge means cancelling the parent's padding with a negative margin
 *     and putting it back inside, and the two have to match exactly. They were written separately in each of the
 *     three places this replaced (-mx-4/px-4, -mx-0.5/px-0.5, and one with none), so `bleed` sets both from a
 *     single value and they cannot drift apart.
 *   - A hidden scrollbar that still scrolls, spelled the same way everywhere.
 *
 * `Bleed` was proposed alongside this and deliberately not built: every bleed in the app is part of a scroller,
 * so a standalone component would have had no callers and would have been one more way to write the arithmetic.
 */
export interface ScrollerProps<T extends ElementType> {
  /**
   * Horizontal padding to cancel so the strip reaches the screen edges, as a CSS length — "1rem" for a page
   * gutter, "2px" for a row that only needs its focus rings not to clip. The margin and padding both come from
   * this one value.
   */
  bleed?: string;
  as?: T;
  className?: string;
  children?: ReactNode;
}

export function Scroller<T extends ElementType = "div">({
  bleed,
  as,
  className,
  style,
  children,
  ...rest
}: ScrollerProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof ScrollerProps<T>>) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      {...rest}
      style={{ ...(style as CSSProperties), ...(bleed ? ({ "--scroller-bleed": bleed } as CSSProperties) : {}) }}
      className={cn(
        "flex overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-webkit-overflow-scrolling:touch]",
        "[&::-webkit-scrollbar]:hidden",
        bleed && "mx-[calc(var(--scroller-bleed)*-1)] px-[var(--scroller-bleed)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

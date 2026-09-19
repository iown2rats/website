"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Two tab patterns from the prototype:
 *  - SegmentedControl (Likes You / Matches): surface-muted track, segments 36 px radius 14, active = surface
 *    background + shadow-sm + text colour; inactive = secondary text.
 *  - PillTabs (Community, Edit profile): 34 px pills; active = rose background, plum text.
 * Compact pass (§32): 42 → 36 and 38 → 34, and the labels dropped from 700 to 500 — a tab row is navigation.
 */

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({ items, value, onChange, label, className }: TabsProps<T>) {
  const id = useId();
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 p-0.75 rounded-lg bg-surface-muted", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            id={`${id}-${item.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => handleArrowKeys(e, items, value, onChange)}
            className={cn(
              "flex-1 h-9 rounded-md text-body font-medium transition-colors duration-200 border-0",
              active ? "bg-surface text-text shadow-sm" : "bg-transparent text-text-secondary",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function PillTabs<T extends string>({ items, value, onChange, label, className, scrollable = false }: TabsProps<T> & { scrollable?: boolean }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex gap-2", scrollable && "overflow-x-auto -mx-4 px-4 pb-0.5 [scrollbar-width:none]", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => handleArrowKeys(e, items, value, onChange)}
            className={cn(
              "shrink-0 h-8.5 px-3.5 rounded-full text-body-sm font-medium whitespace-nowrap",
              active ? "bg-primary text-on-primary" : "bg-surface-muted text-text",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function handleArrowKeys<T extends string>(e: React.KeyboardEvent, items: TabItem<T>[], value: T, onChange: (v: T) => void) {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  e.preventDefault();
  const index = items.findIndex((i) => i.value === value);
  const next = e.key === "ArrowRight" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
  const target = items[next];
  if (!target) return;
  onChange(target.value);
  const el = (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined);
  el?.focus();
}

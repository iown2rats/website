"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Two tab patterns from the prototype:
 *  - SegmentedControl (Likes You / Matches): surface-muted track radius 18 padding 4, segments 42 px radius 14,
 *    active = surface background + shadow-sm + text colour; inactive = secondary text.
 *  - PillTabs (Community, Edit profile): 38 px pills, 1.5 px border; active = rose background, plum text.
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
    <div role="tablist" aria-label={label} className={cn("flex gap-1.5 p-1 rounded-xl bg-surface-muted", className)}>
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
              "flex-1 h-10.5 rounded-md text-body-sm font-bold transition-colors duration-200 border-0",
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
              "shrink-0 h-9.5 px-4 rounded-full border-[1.5px] text-body-sm font-bold whitespace-nowrap",
              active ? "bg-primary text-on-primary border-primary" : "bg-surface text-text border-border",
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

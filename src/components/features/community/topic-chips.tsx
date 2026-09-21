"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { Scroller } from "@/components/ui/scroller";
import { TOPICS, type TopicKey } from "@/server/community/topics";

/**
 * The topic row under the feed tabs (spec §1). Deliberately lighter than PillTabs: no track, no outline and no
 * filled background until a chip is chosen, so the row reads as a filter on the feed rather than a second
 * navigation bar competing with the one directly above it.
 *
 * It scrolls sideways inside `Scroller`, which is the app's one sanctioned horizontal-scroll shape — the page
 * itself must never scroll sideways, and at 320px six chips plus "All" will not fit any other way. Because most of
 * the row is off-screen on a phone, a chip that is selected from elsewhere (the compose sheet pre-selecting
 * "Polls", the "Busy this week" module) is scrolled into view; otherwise the filter appears to have done nothing.
 *
 * The selected chip is aqua, not coral. The feed tabs directly above it use the coral fill, and two coral pills
 * stacked one above the other read as one control that has lost track of which row you are in.
 */
export function TopicChips({ value, onChange, className, disabled = false }: { value: TopicKey | null; onChange: (topic: TopicKey | null) => void; className?: string; disabled?: boolean }) {
  const items: { key: TopicKey | null; label: string }[] = [{ key: null, label: "All" }, ...TOPICS.map((t) => ({ key: t.key as TopicKey | null, label: t.label }))];
  const active = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = active.current;
    if (!el) return;
    /*
     * Deferred by a frame on purpose. When this row sits inside the compose sheet, the <dialog> is still
     * display:none while this effect runs — child effects fire before the parent's showModal() — and
     * scrollIntoView on a hidden element silently does nothing, which is how the pre-selected chip ended up
     * off-screen with the row apparently showing no selection at all.
     */
    const frame = requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <Scroller bleed="1rem" role="group" aria-label="Filter by topic" className={cn("gap-1.5", className)}>
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key ?? "all"}
            ref={selected ? active : undefined}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(item.key)}
            className={cn(
              "h-8 shrink-0 whitespace-nowrap rounded-full border-0 px-3 text-body-sm font-medium transition-colors duration-150 disabled:opacity-60",
              selected ? "bg-aqua-soft text-primary-ink" : "bg-transparent text-text-secondary hover:bg-surface-muted",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </Scroller>
  );
}

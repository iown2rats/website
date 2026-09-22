"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { REACTIONS, reactionGlyph, reactionLabel, type ReactionKey, type ReactionSummaryDto } from "@/lib/reactions";
import { BottomSheet, DialogTitle } from "./dialog";

/*
 * The reaction controls, shared by Chat and Community so the two cannot drift apart (docs/DESIGN_SYSTEM.md §40).
 *
 * Three pieces, and the restraint is the point. The brief asked for Messenger's behaviour without Messenger's
 * noise: "do not turn the feed into a large row of permanently visible emojis", "no clutter", "do not add
 * unnecessary modals or oversized menus".
 *
 *   ReactionPicker  — a floating row of six, 44px targets, positioned NEAR the thing pressed and clamped inside
 *                     the viewport. Not a sheet: a sheet for six emoji covers the message you are reacting to,
 *                     which is the one thing you need to still see.
 *   ReactionSummary — a compact pill per reaction that actually exists. Nothing is rendered when nobody has
 *                     reacted, so a quiet feed stays exactly as quiet as it was.
 *   ReactorSheet    — who reacted, on demand only. The summary shows counts; names cost a tap.
 */

const PICKER_HEIGHT = 56;
/**
 * The row's exact width: six 44px targets, five 2px gaps, 6px of padding either side. Fixed rather than measured,
 * because measuring would mean rendering the row somewhere first and then moving it — a visible flinch on the one
 * control that has to feel instant. The buttons are square and sized in CSS, so the emoji font cannot change this.
 */
const PICKER_WIDTH = 6 * 44 + 5 * 2 + 2 * 6;
/** Keeps the row off the very edge of a phone screen, and clear of the notch. */
const EDGE = 8;

/** Where the row goes: centred on the press, clamped inside the viewport, above the finger where there is room. */
function placePicker(at: { x: number; y: number }): { left: number; top: number } {
  const vw = typeof window === "undefined" ? 360 : window.innerWidth;
  const vh = typeof window === "undefined" ? 640 : window.innerHeight;
  const left = Math.min(Math.max(at.x - PICKER_WIDTH / 2, EDGE), Math.max(EDGE, vw - PICKER_WIDTH - EDGE));
  // Above by preference — a row under the thumb is a row you cannot see.
  const above = at.y - PICKER_HEIGHT - 12;
  return { left, top: above >= EDGE ? above : Math.min(at.y + 16, vh - PICKER_HEIGHT - EDGE) };
}

export interface ReactionPickerProps {
  /** Screen coordinates of the press. The row is placed just above them, or below when there is no room. */
  at: { x: number; y: number } | null;
  /** The viewer's current reaction, drawn as selected so "tap it again to remove" is visible rather than implied. */
  current: ReactionKey | null;
  onPick: (emoji: ReactionKey | null) => void;
  onClose: () => void;
  /** Named for screen readers: "React to Hind's message". */
  label: string;
}

export function ReactionPicker({ at, current, onPick, onClose, label }: ReactionPickerProps) {
  // Escape, and any scroll or outside tap, dismisses. A picker that outlives the thing it points at is a bug.
  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, { capture: true, passive: true });
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onClose);
    };
  }, [at, onClose]);

  if (!at) return null;
  const box = placePicker(at);

  return (
    <>
      {/*
        * A transparent catcher rather than a scrim: dimming the screen for a six-emoji choice is the "oversized"
        * the brief ruled out, and the message being reacted to has to stay legible behind the row.
        */}
      <div className="fixed inset-0 z-40" onPointerDown={onClose} aria-hidden="true" />
      <div
        role="group"
        aria-label={label}
        className="fixed z-50 flex items-center gap-0.5 rounded-full glass-card px-1.5 py-1 animate-fade-in"
        style={{ left: box.left, top: box.top, width: PICKER_WIDTH }}
      >
        {REACTIONS.map((r) => {
          const mine = current === r.key;
          return (
            <button
              key={r.key}
              type="button"
              // Tapping the one you already have is how you take it off, and the server is told "none" rather
              // than being asked to work out a toggle it could get wrong against a stale client.
              onClick={() => onPick(mine ? null : r.key)}
              aria-pressed={mine}
              aria-label={mine ? `Remove your ${r.label} reaction` : `React with ${r.label}`}
              className={cn(
                "grid size-11 place-items-center rounded-full border-0 bg-transparent text-[22px] leading-none pressable-round",
                mine && "bg-primary-soft",
              )}
            >
              <span aria-hidden="true">{r.glyph}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export interface ReactionSummaryProps {
  reactions: ReactionSummaryDto;
  /** Tapping a pill sets or clears that reaction — the quick path that needs no picker. */
  onToggle?: (emoji: ReactionKey | null) => void;
  /** Tapping the total opens the reactor list. Omitted where there is nobody to name. */
  onInspect?: () => void;
  /** Screen-reader context for the row: "Reactions on Hind's message". */
  label: string;
  className?: string;
}

/**
 * The grouped counts under a message, post or comment.
 *
 * Renders NOTHING when there are no reactions — the single most important line in this file, and the reason a
 * feed of unreacted posts looks precisely as it did before any of this existed. A count appears beside an emoji
 * only once more than one person has chosen it, so the common case (one reaction) is one small glyph.
 */
export function ReactionSummary({ reactions, onToggle, onInspect, label, className }: ReactionSummaryProps) {
  if (reactions.groups.length === 0) return null;
  return (
    <div className={cn("flex items-center gap-1", className)} role="group" aria-label={label}>
      {reactions.groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          disabled={!onToggle}
          onClick={() => onToggle?.(g.mine ? null : g.emoji)}
          aria-pressed={g.mine}
          aria-label={`${g.count} ${reactionLabel(g.emoji)}${g.mine ? ", including you. Tap to remove yours" : ". Tap to add yours"}`}
          className={cn(
            "flex h-6.5 items-center gap-0.75 rounded-full border px-1.75 text-micro tabular-nums",
            g.mine ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface-muted text-text-secondary",
            !onToggle && "cursor-default",
          )}
        >
          <span aria-hidden="true" className="text-[13px] leading-none">{reactionGlyph(g.emoji)}</span>
          {g.count > 1 ? <span aria-hidden="true">{g.count}</span> : null}
        </button>
      ))}
      {onInspect ? (
        <button
          type="button"
          onClick={onInspect}
          aria-label={`See who reacted (${reactions.total})`}
          className="h-6.5 rounded-full border-0 bg-transparent px-1 text-micro text-text-muted"
        >
          {/* An em dash of a control: present for anyone who wants the names, invisible to anyone who does not. */}
          <span aria-hidden="true">···</span>
        </button>
      ) : null}
    </div>
  );
}

export interface ReactorRow {
  emoji: ReactionKey;
  name: string;
  isMe: boolean;
  /** Optional avatar slot, so Community can show a face and Chat can show nothing. */
  avatar?: ReactNode;
}

/** Who reacted, and with what. Opened from the summary, never shown unasked. */
export function ReactorSheet({ open, onClose, rows, loading }: { open: boolean; onClose: () => void; rows: ReactorRow[]; loading: boolean }) {
  return (
    <BottomSheet open={open} onClose={onClose} label="Reactions">
      <DialogTitle>Reactions</DialogTitle>
      {loading ? (
        <p className="py-4 text-center text-body-sm text-text-secondary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-body-sm text-text-secondary">No reactions yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {rows.map((row, i) => (
            <li key={`${row.emoji}:${row.name}:${i}`} className="flex min-h-11 items-center gap-2.5 px-1">
              {row.avatar ?? null}
              <span className="min-w-0 flex-1 truncate text-body text-text">{row.name}</span>
              <span aria-label={reactionLabel(row.emoji)} className="text-[18px] leading-none">
                {reactionGlyph(row.emoji)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}

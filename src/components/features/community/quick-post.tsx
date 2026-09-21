"use client";

import { Avatar } from "@/components/ui/avatar";
import { Scroller } from "@/components/ui/scroller";
import type { CommunityPostKind } from "@/server/community/dto";
import { postKind } from "./post-kinds";

/** The four shortcuts, in the order the brief gives them (spec §2). */
const QUICK: readonly CommunityPostKind[] = ["QUESTION", "POLL", "CONFESSION", "TEXT"];

export interface QuickPostProps {
  /** The viewer's own avatar, so the row reads as "you, about to say something" rather than as a banner. */
  photo: { url: string | null; key: string | null; blurhash: string } | null;
  name: string;
  onCompose: (kind: CommunityPostKind) => void;
}

/**
 * "What's happening?" above the feed (spec §2).
 *
 * Not a card: no surface, no radius, no shadow — just the viewer's avatar, a line of prompt text and four small
 * shortcuts, separated from the first post by a hairline. The brief asks for something that sits IN the feed, and
 * anything with a glass-card behind it would become the loudest thing on the screen and push the first real post
 * below the fold on a 320 px phone.
 *
 * The shortcuts scroll sideways rather than wrapping, so the row is exactly one line tall at every width.
 */
export function QuickPost({ photo, name, onCompose }: QuickPostProps) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/70 px-1 pb-2">
      <button
        type="button"
        onClick={() => onCompose("TEXT")}
        className="flex items-center gap-2.5 border-0 bg-transparent px-0 py-0.5 text-left"
      >
        <Avatar name={name} aria-hidden="true" photo={photo} size={32} />
        <span className="text-body text-text-secondary">What&apos;s happening?</span>
      </button>
      <Scroller bleed="1rem" className="gap-1.5" aria-label="Post something">
        {QUICK.map((value) => {
          const kind = postKind(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => onCompose(value)}
              className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-0 bg-surface-muted px-3 text-caption font-medium text-text-secondary hover:text-text"
            >
              <span aria-hidden="true" className="grid place-items-center text-primary-ink [&>svg]:size-4">
                {kind.icon}
              </span>
              {kind.label}
            </button>
          );
        })}
      </Scroller>
    </div>
  );
}

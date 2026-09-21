"use client";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/dialog";
import type { CommunityPostKind } from "@/server/community/dto";
import { POST_KINDS } from "./post-kinds";

/**
 * What the coral + button opens (spec §4): pick the kind first, then compose. Five rows in one grouped block,
 * built on the app's BottomSheet so it inherits the sheet chrome, the focus trap, Escape and the safe-area
 * padding rather than reimplementing them.
 *
 * Compact on purpose: 56 px rows, label and one line of hint, no illustrations. On a 320 px screen the whole
 * sheet plus Cancel still sits inside the small viewport with nothing to scroll.
 */
export function CreateMenu({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (kind: CommunityPostKind) => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} label="New post">
      <div className="flex flex-col overflow-hidden rounded-2xl bg-surface-muted [&>*+*]:border-t [&>*+*]:border-border">
        {POST_KINDS.map((kind) => (
          <button
            key={kind.value}
            type="button"
            onClick={() => onPick(kind.value)}
            className="flex items-center gap-3 border-0 bg-transparent px-4 py-2.5 text-left hover:bg-surface-muted"
          >
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-aqua-soft text-primary-ink">
              {kind.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-lg font-medium text-text">{kind.label}</span>
              <span className="block truncate text-caption text-text-secondary">{kind.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="muted" onClick={onClose} fullWidth className="rounded-xl">
        Cancel
      </Button>
    </BottomSheet>
  );
}

import { IconButton } from "@/components/ui/button";
import { PlusTag } from "@/components/ui/badge";
import { CloseIcon, HeartIcon, PersonIcon, StarIcon, UndoIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/*
 * Deck controls (prototype line 172–176): centred row, 20 px gap, 68 px tall at bottom 4 px:
 * Pass 56 px bordered white circle (X 24/2.4), Like 66 px teal gradient circle with like glow (heart 30 filled),
 * Super Like 44 px bordered circle with a gold star in the slot the prototype drew for Intro (a message with a
 * like is what a Super Like now is, §12.20) — with the PLUS tag at the corner for a Free member, who still sees it and
 * is shown what it is on tap; View profile 48 px bordered.
 * Undo (Plus) is added as a 48 px control on the far left when enabled. For a Free member (while PLUS_UNDO_UI is
 * on) it carries the same PLUS tag as Intro; tapping it asks the server, and only a refusal explains Plus — nothing
 * is shown after an ordinary pass.
 */
export interface SwipeControlsProps {
  onPass: () => void;
  onLike: () => void;
  onSuperLike?: () => void;
  /** Free (or lapsed Plus): the star carries the PLUS tag and a tap explains Plus; nothing is sent. */
  superLikeLocked?: boolean;
  onOpen?: () => void;
  onUndo?: () => void;
  undoDisabled?: boolean;
  undoLocked?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SwipeControls({ onPass, onLike, onSuperLike, superLikeLocked = false, onOpen, onUndo, undoDisabled = false, undoLocked = false, disabled = false, className }: SwipeControlsProps) {
  return (
    <div className={cn("flex h-15 items-center justify-center gap-4", className)}>
      {onUndo ? (
        <IconButton aria-label={undoLocked ? "Undo last pass (Plus)" : "Undo last pass"} round elevated size={44} onClick={onUndo} disabled={disabled || undoDisabled} className={cn("text-text-secondary", undoLocked && "relative overflow-visible")}>
          <UndoIcon size={18} strokeWidth={2} />
          {undoLocked ? <PlusTag size="xs" className="absolute -right-1.5 -top-1" /> : null}
        </IconButton>
      ) : null}
      <IconButton aria-label="Pass" round elevated size={48} onClick={onPass} disabled={disabled}>
        <CloseIcon size={21} strokeWidth={2.1} />
      </IconButton>
      <button
        type="button"
        aria-label="Like"
        onClick={onLike}
        disabled={disabled}
        className="grid size-14.5 place-items-center rounded-full border-0 like-gradient text-on-primary shadow-like pressable-round disabled:opacity-45"
      >
        <HeartIcon size={26} filled strokeWidth={0} />
      </button>
      {onSuperLike ? (
        <IconButton aria-label={superLikeLocked ? "Super Like (Plus)" : "Super Like"} round elevated size={44} onClick={onSuperLike} disabled={disabled} className="relative overflow-visible text-sand">
          <StarIcon size={20} filled strokeWidth={0} />
          {superLikeLocked ? <PlusTag size="xs" className="absolute -right-1.5 -top-1" /> : null}
        </IconButton>
      ) : null}
      {onOpen ? (
        <IconButton aria-label="View profile" round elevated size={44} onClick={onOpen} disabled={disabled}>
          <PersonIcon size={21} strokeWidth={2} />
        </IconButton>
      ) : null}
    </div>
  );
}

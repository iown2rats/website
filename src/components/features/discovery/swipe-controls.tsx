import { IconButton } from "@/components/ui/button";
import { PlusTag } from "@/components/ui/badge";
import { ChatPlusIcon, CloseIcon, HeartIcon, PersonIcon, UndoIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/*
 * Deck controls (prototype line 172–176): centred row, 20 px gap, 68 px tall at bottom 4 px:
 * Pass 56 px bordered white circle (X 24/2.4), Like 66 px teal gradient circle with like glow (heart 30 filled),
 * Intro 48 px bordered circle with ocean chat-plus icon and a PLUS tag at the corner, View profile 48 px bordered.
 * Undo (Plus) is added as a 48 px control on the far left when enabled.
 */
export interface SwipeControlsProps {
  onPass: () => void;
  onLike: () => void;
  onIntro?: () => void;
  onOpen?: () => void;
  onUndo?: () => void;
  undoDisabled?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SwipeControls({ onPass, onLike, onIntro, onOpen, onUndo, undoDisabled = false, disabled = false, className }: SwipeControlsProps) {
  return (
    <div className={cn("flex h-17 items-center justify-center gap-5", className)}>
      {onUndo ? (
        <IconButton aria-label="Undo last pass" round elevated size={48} onClick={onUndo} disabled={disabled || undoDisabled} className="text-text-secondary">
          <UndoIcon size={20} strokeWidth={2.2} />
        </IconButton>
      ) : null}
      <IconButton aria-label="Pass" round elevated size={56} onClick={onPass} disabled={disabled}>
        <CloseIcon size={24} strokeWidth={2.4} />
      </IconButton>
      <button
        type="button"
        aria-label="Like"
        onClick={onLike}
        disabled={disabled}
        className="grid size-16.5 place-items-center rounded-full border-0 like-gradient text-on-primary shadow-like pressable-round disabled:opacity-45"
      >
        <HeartIcon size={30} filled strokeWidth={0} />
      </button>
      {onIntro ? (
        <IconButton aria-label="Send intro (Plus)" round elevated size={48} onClick={onIntro} disabled={disabled} className="relative text-ocean overflow-visible">
          <ChatPlusIcon size={20} strokeWidth={2.2} />
          <PlusTag size="xs" className="absolute -right-1.5 -top-1" />
        </IconButton>
      ) : null}
      {onOpen ? (
        <IconButton aria-label="View profile" round elevated size={48} onClick={onOpen} disabled={disabled}>
          <PersonIcon size={24} strokeWidth={2.2} />
        </IconButton>
      ) : null}
    </div>
  );
}

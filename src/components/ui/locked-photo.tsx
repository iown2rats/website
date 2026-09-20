"use client";

import { BlurhashCanvas } from "@/components/ui/blurhash";
import { LockIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/**
 * A protected photo the viewer has not unlocked (docs/DESIGN_SYSTEM.md §34, ARCHITECTURE.md §12.18).
 *
 * The preview is a blurhash, not a blurred photograph. That is the whole point: the server never sent the image,
 * so there is nothing here to un-blur, screenshot at higher fidelity or pull out of a network panel. The canvas is
 * 32×42 pixels stretched to fill, which is why it reads as a soft wash of the real photo's colours and nothing
 * more — the same representation Free viewers have always had in the Likes You teaser.
 *
 * The viewer is meant to understand that a photo exists and that it is theirs on Plus. Gold is the Plus accent;
 * rose stays the brand accent and is deliberately not used here.
 */
export function LockedPhoto({
  blurhash,
  onUnlock,
  className,
  label = "Unlock with Plus",
  compact = false,
}: {
  blurhash: string | null;
  onUnlock?: () => void;
  className?: string;
  label?: string;
  /** Small tiles (a card's photo strip) show the lock alone; large ones show the wording too. */
  compact?: boolean;
}) {
  const body = (
    <>
      <BlurhashCanvas hash={blurhash} className="absolute inset-0 size-full object-cover" />
      {/* A wash over the hash so the gold reads at any brightness, without an outline. */}
      <span aria-hidden="true" className="absolute inset-0 bg-scrim/35" />
      <span className="relative flex flex-col items-center gap-2 text-on-photo">
        <span className="grid size-11 place-items-center rounded-full bg-sand/25 text-sand backdrop-blur-sm" aria-hidden="true">
          <LockIcon size={compact ? 16 : 20} />
        </span>
        {compact ? null : <span className="text-caption font-medium text-sand">{label}</span>}
      </span>
    </>
  );

  const shell = cn("relative grid place-items-center overflow-hidden bg-surface-muted", className);
  if (!onUnlock) {
    return (
      <div className={shell} role="img" aria-label={`Locked photo. ${label}.`}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" onClick={onUnlock} aria-label={`Locked photo. ${label}.`} className={cn(shell, "border-0 p-0 text-left pressable")}>
      {body}
    </button>
  );
}

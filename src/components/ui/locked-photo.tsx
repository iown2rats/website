"use client";

import { LockIcon } from "@/components/ui/icons";
import { blurhashAverageColor, blurhashDataUrl } from "@/lib/blurhash-image";
import { cn } from "@/lib/cn";

/**
 * A protected photo the viewer has not unlocked (docs/DESIGN_SYSTEM.md §34, ARCHITECTURE.md §12.18).
 *
 * The preview is a blurhash, not a blurred photograph. That is the whole point: the server never sent the image,
 * so there is nothing here to un-blur, screenshot at higher fidelity or pull out of a network panel. The hash is
 * the member's own photo reduced to twelve colour terms — as blurred as a photo can be and still be that photo — and
 * it is drawn at 32×42 and stretched, then frosted, so what reaches the eye is the photo's colours and no shape.
 *
 * Opacity is structural, never incidental. The tile sits on a swipe card with the NEXT member's card directly
 * beneath it, so every layer is laid out so that nothing below can show through:
 *  1. the shell's background is the photo's average colour, read from the hash string in render — opaque from the
 *     first frame, on the server as well as the client, with no effect or decode to wait for;
 *  2. the decoded hash is a background image on the same frame (no <canvas>, which painted only after an effect
 *     and could fail to composite inside a moving, clipped layer);
 *  3. a frost wash and the lock go on top. No `backdrop-filter` and no CSS `filter` anywhere: the card this sits
 *     on moves every frame of a drag, and both would be recomputed on every one of them.
 * `fill` positions the tile absolutely over its parent. It is a prop rather than a caller's `absolute inset-0`
 * because `cn` joins classes without resolving conflicts: a caller's `absolute` next to the shell's own `relative`
 * lost to it in the stylesheet, and the tile collapsed to the height of its lock.
 *
 * The viewer is meant to understand that a photo exists and that it is theirs on Plus. Gold is the Plus accent;
 * rose stays the brand accent and is deliberately not used here.
 */
export function LockedPhoto({
  blurhash,
  onUnlock,
  className,
  label = "Unlock with Plus",
  title,
  compact = false,
  fill = false,
}: {
  blurhash: string | null;
  onUnlock?: () => void;
  className?: string;
  label?: string;
  /** Optional headline above the label, e.g. "3 more photos" — a count the caller took from the server's DTO. */
  title?: string;
  /** Small tiles (a card's photo strip) show the lock alone; large ones show the wording too. */
  compact?: boolean;
  /** Cover the positioned parent (a swipe card, a hero) instead of sizing itself. */
  fill?: boolean;
}) {
  const average = blurhashAverageColor(blurhash);
  const image = blurhashDataUrl(blurhash, 32, 42, 0.8);
  const body = (
    <>
      {image ? <span aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: `url(${image})`, backgroundSize: "100% 100%" }} /> : null}
      {/* The frost: keeps the colour, takes the last of the shape, and gives the gold lock a calm field to sit on. */}
      <span aria-hidden="true" className="absolute inset-0 bg-linear-160 from-locked-frost to-locked-frost-edge" />
      <span className="relative flex flex-col items-center gap-2 text-on-photo">
        <span className="grid size-11 place-items-center rounded-full bg-ocean/80 text-sand shadow-sm" aria-hidden="true">
          <LockIcon size={compact ? 16 : 20} />
        </span>
        {compact || !title ? null : <span className="rounded-full bg-ocean/80 px-3 py-0.5 text-body font-semibold text-on-photo">{title}</span>}
        {compact ? null : <span className="rounded-full bg-ocean/80 px-3 py-0.5 text-caption font-medium text-sand">{label}</span>}
      </span>
    </>
  );

  const shell = cn(fill ? "absolute inset-0" : "relative", "isolate grid place-items-center overflow-hidden bg-card-base", className);
  const style = average ? { backgroundColor: average } : undefined;
  if (!onUnlock) {
    return (
      <div className={shell} style={style} role="img" aria-label={title ? `${title}, locked. ${label}.` : `Locked photo. ${label}.`}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" onClick={onUnlock} style={style} aria-label={title ? `${title}, locked. ${label}.` : `Locked photo. ${label}.`} className={cn(shell, "border-0 p-0 text-left pressable")}>
      {body}
    </button>
  );
}

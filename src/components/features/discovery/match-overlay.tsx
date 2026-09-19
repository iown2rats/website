"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { photoBackground, type PhotoRef } from "@/lib/photos";

/*
 * Prototype "MATCH" overlay: full-bleed ocean panel, two 420 px ripple rings (3 s, staggered 1.5 s),
 * two 132×176 white-bordered photo cards rotated ∓8° overlapping by 14 px with pop-in, "It's a Match" 34/800,
 * "You and {name} liked each other." 16 px at 75 % white, then "Say hello" (primary 52) and "Keep swiping" (48, white/10).
 */
export interface MatchOverlayProps {
  open: boolean;
  name: string;
  theirPhoto: PhotoRef | null;
  myPhoto: PhotoRef | null;
  onSayHello: () => void;
  onKeepSwiping: () => void;
}

export function MatchOverlay({ open, name, theirPhoto, myPhoto, onSayHello, onKeepSwiping }: MatchOverlayProps) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onKeepSwiping(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onKeepSwiping]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-title"
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 overflow-hidden bg-primary p-6 text-center text-on-primary animate-fade-in"
    >
      <span aria-hidden="true" className="absolute size-105 rounded-full bg-white opacity-25 motion-ok:animate-[ripple_3s_ease-out_infinite]" />
      <span aria-hidden="true" className="absolute size-105 rounded-full bg-white opacity-20 motion-ok:animate-[ripple_3s_ease-out_1.5s_infinite]" />
      <div className="relative flex items-center motion-ok:animate-[pop-in_.5s_var(--ease-out-soft)_both]" aria-hidden="true">
        <div className="h-44 w-33 rounded-[22px] border-[3px] border-white bg-aqua-soft shadow-lg -rotate-8 translate-x-3.5" style={photoBackground(myPhoto, 200, "thumb")} />
        <div className="h-44 w-33 rounded-[22px] border-[3px] border-white bg-aqua-soft shadow-lg rotate-8 -translate-x-3.5" style={photoBackground(theirPhoto, 160, "thumb")} />
      </div>
      <div className="relative flex flex-col gap-2.5">
        <h2 id="match-title" className="text-display">It&apos;s a Match</h2>
        <p className="text-body-lg text-on-primary/80">You and {name} liked each other.</p>
      </div>
      <div className="relative flex w-full max-w-90 flex-col gap-2.5">
        <Button ref={primary} variant="white" onClick={onSayHello} fullWidth className="shadow-sm">Say hello</Button>
        <button type="button" onClick={onKeepSwiping} className="h-11 rounded-lg border-0 bg-white/35 text-body font-medium text-on-primary pressable">
          Keep swiping
        </button>
      </div>
    </div>
  );
}

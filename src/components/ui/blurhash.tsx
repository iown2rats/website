"use client";

import { decode } from "blurhash";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Renders a blurhash placeholder on a small canvas. Used where the server deliberately sends no image: the Free
 * Likes You teaser (docs/ARCHITECTURE.md §12.5). The hash carries no identity, so nothing can be recovered from it.
 */
export function BlurhashCanvas({ hash, className, label }: { hash: string | null; className?: string; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !hash) return;
    try {
      const pixels = decode(hash, 32, 42);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const image = ctx.createImageData(32, 42);
      image.data.set(pixels);
      ctx.putImageData(image, 0, 0);
    } catch {
      // A malformed hash simply leaves the muted background.
    }
  }, [hash]);
  return <canvas ref={ref} width={32} height={42} className={cn("size-full bg-surface-muted", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

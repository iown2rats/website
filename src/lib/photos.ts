import type { CSSProperties } from "react";

/**
 * Photo reference as it reaches components. In Phase 4 only demo placeholders exist; real photos
 * arrive as short-lived signed URLs from the storage layer in a later phase.
 */
export interface PhotoRef {
  /** Signed URL when available. */
  url?: string | null;
  /** Signed URL of the 400 px variant, for previews and avatars. */
  thumbUrl?: string | null;
  /** Storage key. Demo keys look like `demo/<user>/<n>.hue-<h>` and render as lagoon gradients. */
  key?: string | null;
  blurhash?: string | null;
  alt?: string;
}

const DEMO_HUE = /hue-(\d{1,3})/;

/** The prototype's placeholder gradient: linear-gradient(160deg, hsl(h 45% 74%), hsl(h 55% 42%)). */
export function demoGradient(hue: number, direction = 160): string {
  return `linear-gradient(${direction}deg, hsl(${hue} 45% 74%), hsl(${hue} 55% 42%))`;
}

export function demoHue(key: string | null | undefined): number | null {
  const m = key ? DEMO_HUE.exec(key) : null;
  return m ? Number(m[1]) : null;
}

/** Background style for a photo surface: real image when a URL exists, demo gradient otherwise. */
export function photoBackground(photo: PhotoRef | null, direction = 160, variant: "full" | "thumb" = "full"): CSSProperties {
  const url = variant === "thumb" ? (photo?.thumbUrl ?? photo?.url) : photo?.url;
  if (url) {
    return { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  const hue = demoHue(photo?.key);
  if (hue != null) return { backgroundImage: demoGradient(hue, direction) };
  return {};
}

export function isDemoPhoto(photo: PhotoRef | null): boolean {
  return !photo?.url && demoHue(photo?.key) != null;
}

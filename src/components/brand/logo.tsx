import Image from "next/image";
import { cn } from "@/lib/cn";

/*
 * Mellocrush brand assets (public/brand, derived from brand-source by scripts/build-brand-assets.py). The wordmark is
 * the supplied artwork — lowercase "mellocrush" with the interlocking coral "oo" #EE5358 and the gold heart #FDA748 —
 * used exactly as delivered: it is an image, never recreated with text, and its proportions are never altered.
 *
 * The lettering ships in two colours because the artwork is a raster and cannot follow `--text` the way everything
 * else does: navy #0B1A2B (the artwork's own dark) for the sand page colour, white for black and for dark
 * photographs. `tone="auto"` renders both and lets CSS pick, because appearance is a localStorage choice applied on
 * the client, so the server cannot know which one this viewer wants (see .wordmark-ink / .wordmark-white in
 * globals.css). Fix a tone explicitly wherever the surface is known regardless of theme.
 *
 * Icon-only places use the interlocking "oo" with the heart (BrandMark); the full wordmark is never squeezed into a
 * tiny space.
 */
export const BRAND_NAME = "Mellocrush";
/** Navy lettering, for the sand page colour. */
export const WORDMARK_INK_SRC = "/brand/mellocrush-logo-480.png";
/** White lettering, for black and for dark photographs; the coral "oo" and gold heart are unchanged. */
export const WORDMARK_WHITE_SRC = "/brand/mellocrush-logo-white-480.png";
export const WORDMARK_ASPECT = 1492 / 284;
export const MARK_SRC = "/brand/mellocrush-mark.png";

/** Which lettering colour to draw: `auto` follows the appearance setting, the others are fixed. */
export type WordmarkTone = "auto" | "ink" | "white";

/** The full lowercase wordmark at a given height; width follows the artwork's aspect ratio. */
export function Wordmark({ height = 24, className, priority = false, tone = "auto" }: { height?: number; className?: string; priority?: boolean; tone?: WordmarkTone }) {
  const width = Math.round(height * WORDMARK_ASPECT);
  const common = { width, height, priority, unoptimized: true, style: { width, height } };
  if (tone !== "auto") {
    return <Image {...common} alt={BRAND_NAME} src={tone === "white" ? WORDMARK_WHITE_SRC : WORDMARK_INK_SRC} className={cn("block shrink-0 select-none", className)} />;
  }
  // Both carry the name rather than one of them: `display: none` takes the other out of the accessibility tree, so
  // exactly one is announced in either appearance. Marking one aria-hidden would leave the logo unnamed in the
  // appearance where that is the visible file.
  return (
    <>
      <Image {...common} alt={BRAND_NAME} src={WORDMARK_INK_SRC} className={cn("wordmark-ink shrink-0 select-none", className)} />
      <Image {...common} alt={BRAND_NAME} src={WORDMARK_WHITE_SRC} className={cn("wordmark-white shrink-0 select-none", className)} />
    </>
  );
}

/** The interlocking coral "oo" with the gold heart, for icon-only places (compact headers, favicon-sized slots). */
export function BrandMark({ size = 24, className, label = BRAND_NAME }: { size?: number; className?: string; label?: string }) {
  return <Image src={MARK_SRC} alt={label} width={size} height={size} unoptimized className={cn("block shrink-0 select-none", className)} style={{ width: size, height: size }} />;
}

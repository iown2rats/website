import Image from "next/image";
import wordmarkInk from "@/assets/brand/mellocrush-logo-480.png";
import wordmarkWhite from "@/assets/brand/mellocrush-logo-white-480.png";
import mark from "@/assets/brand/mellocrush-mark.png";
import { cn } from "@/lib/cn";

/*
 * Mellocrush brand assets (src/assets/brand, derived from brand-source by scripts/build-brand-assets.py). The
 * wordmark is the supplied artwork — lowercase "mellocrush" with the interlocking coral "oo" #EE5358 and the gold
 * heart #FDA748 — used exactly as delivered: it is an image, never recreated with text, and its proportions are
 * never altered.
 *
 * Imported rather than referenced at a `/brand/...` URL so the bundler fingerprints each file and serves it
 * immutable. A logo at a fixed public path is a logo a browser can keep showing after the artwork changes, and
 * `public/` files ship as `max-age=0, must-revalidate`, which iOS Safari treats as a suggestion. The first upload of
 * this artwork left the old mark on screen for exactly that reason.
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
export const WORDMARK_INK = wordmarkInk;
/** White lettering, for black and for dark photographs; the coral "oo" and gold heart are unchanged. */
export const WORDMARK_WHITE = wordmarkWhite;
export const WORDMARK_ASPECT = 1492 / 284;
export const MARK = mark;

/** Which lettering colour to draw: `auto` follows the appearance setting, the others are fixed. */
export type WordmarkTone = "auto" | "ink" | "white";

/** The full lowercase wordmark at a given height; width follows the artwork's aspect ratio. */
export function Wordmark({ height = 24, className, priority = false, tone = "auto" }: { height?: number; className?: string; priority?: boolean; tone?: WordmarkTone }) {
  const width = Math.round(height * WORDMARK_ASPECT);
  const common = { width, height, priority, unoptimized: true, style: { width, height } };
  if (tone !== "auto") {
    return <Image {...common} alt={BRAND_NAME} src={tone === "white" ? WORDMARK_WHITE : WORDMARK_INK} className={cn("block shrink-0 select-none", className)} />;
  }
  // Both carry the name rather than one of them: `display: none` takes the other out of the accessibility tree, so
  // exactly one is announced in either appearance. Marking one aria-hidden would leave the logo unnamed in the
  // appearance where that is the visible file.
  return (
    <>
      <Image {...common} alt={BRAND_NAME} src={WORDMARK_INK} className={cn("wordmark-ink shrink-0 select-none", className)} />
      <Image {...common} alt={BRAND_NAME} src={WORDMARK_WHITE} className={cn("wordmark-white shrink-0 select-none", className)} />
    </>
  );
}

/** The interlocking coral "oo" with the gold heart, for icon-only places (compact headers, favicon-sized slots). */
export function BrandMark({ size = 24, className, label = BRAND_NAME }: { size?: number; className?: string; label?: string }) {
  return <Image src={MARK} alt={label} width={size} height={size} unoptimized className={cn("block shrink-0 select-none", className)} style={{ width: size, height: size }} />;
}

/**
 * The mark as a single-colour glyph, painted with a CSS token rather than baked into a file.
 *
 * The comparison table needs the mark in the Plus gold, and `--sand` is #c6a962 on the page and #e0c27a on black —
 * one colour cannot be both. Masking the real artwork and filling it with the token means the glyph follows the
 * theme exactly, at any size, from the same file the coral mark already uses. A second gold PNG would have had to
 * be generated per theme and would drift the moment the artwork changed.
 *
 * The mask flattens the heart and the rings into one silhouette, which is what the design calls for at this size.
 */
export function PlusMark({ size = 22, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <span
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("inline-block shrink-0 bg-sand", className)}
      style={{
        width: size,
        height: size,
        maskImage: `url(${mark.src})`,
        WebkitMaskImage: `url(${mark.src})`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}

/**
 * The "mellocrush plus" lockup for the membership hero: the wordmark's own colours in type, over the coral mark
 * with a warm glow behind it. Composed here rather than shipped as one flattened image so the text stays real text
 * — selectable, translatable, and sharp at any density — and so the glow can follow the theme.
 */
export function PlusLockup({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none relative select-none", className)} aria-hidden="true">
      <span className="absolute -inset-6 rounded-full bg-primary/20 blur-2xl" />
      <span className="absolute -inset-2 rounded-full bg-sand/10 blur-xl" />
      <div className="relative flex flex-col items-center gap-0.5">
        <span className="text-tiny font-semibold leading-none tracking-[-.02em] text-primary">mellocrush</span>
        <span className="text-micro font-semibold leading-none tracking-[-.02em] text-sand">plus</span>
        <Image src={MARK} alt="" width={60} height={60} unoptimized className="mt-1 block h-15 w-15 select-none" />
      </div>
    </div>
  );
}

import Image from "next/image";
import { cn } from "@/lib/cn";

/*
 * Mellocrush brand assets (public/brand). The wordmark is the supplied artwork — lowercase "mellocrush" in cocoa
 * #472B30 with the linked coral "oo" #E88B86 and the gold four-point star #C9A04A — used exactly as delivered: it is
 * an image, never recreated with text, and its proportions and spacing are never altered. Icon-only places use the
 * linked "oo" plus the star (BrandMark); the full wordmark is never squeezed into a tiny space.
 */
export const BRAND_NAME = "Mellocrush";
export const WORDMARK_SRC = "/brand/mellocrush-logo-480.png";
/** The same artwork with the cocoa lettering in white, for use over dark photographs; the coral "oo" and gold star are unchanged. */
export const WORDMARK_LIGHT_SRC = "/brand/mellocrush-logo-white-960.png";
export const WORDMARK_ASPECT = 1977 / 326;
export const MARK_SRC = "/brand/mellocrush-mark.png";

/** The full lowercase wordmark at a given height; width follows the artwork's aspect ratio. `tone="light"` is the white-lettering variant for dark photographs. */
export function Wordmark({ height = 24, className, priority = false, tone = "dark" }: { height?: number; className?: string; priority?: boolean; tone?: "dark" | "light" }) {
  const width = Math.round(height * WORDMARK_ASPECT);
  return <Image src={tone === "light" ? WORDMARK_LIGHT_SRC : WORDMARK_SRC} alt={BRAND_NAME} width={width} height={height} priority={priority} unoptimized className={cn("block shrink-0 select-none", className)} style={{ width, height }} />;
}

/** The linked coral "oo" with the gold star, for icon-only places (compact headers, favicon-sized slots). */
export function BrandMark({ size = 24, className, label = BRAND_NAME }: { size?: number; className?: string; label?: string }) {
  return <Image src={MARK_SRC} alt={label} width={size} height={size} unoptimized className={cn("block shrink-0 select-none", className)} style={{ width: size, height: size }} />;
}

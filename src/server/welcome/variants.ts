/**
 * The three shapes a Welcome Screen cover is cut for, and the one place the breakpoints between them live
 * (docs/ARCHITECTURE.md §26). Pure — no server imports — so the admin screen can describe and preview a variant
 * with exactly the rules the browser will apply.
 *
 * These are NOT viewport sizes. One photograph cannot be the right shape for a phone held upright and a desktop
 * window at once, so the browser picks a variant with a `media` query and `object-fit: cover` then fits it to
 * whatever the viewport actually is. The recommended dimensions are what an admin should upload to get a sharp
 * result at that shape; anything else is accepted, warned about, and fitted the same way.
 *
 * Breakpoints: 768 is already this screen's own breakpoint (the auth card and the backdrop's focal point both move
 * there), and 1280 is the project's canonical `wide` tier (globals.css). Width alone decides, so a landscape tablet
 * takes the tablet image and covers it — cropped, never stretched, never letterboxed.
 *
 * ORDER MATTERS. `<picture>` takes the FIRST `<source>` whose media matches, so these run widest-first and the last
 * entry must be the one with no media query: it is the `<img>` every browser falls back to.
 */
export type WelcomeCoverVariantKey = "DESKTOP" | "TABLET" | "MOBILE";

export interface WelcomeCoverVariantSpec {
  key: WelcomeCoverVariantKey;
  label: string;
  /** The `media` attribute for this variant's `<source>`; null marks the `<img>` fallback. */
  media: string | null;
  /**
   * The same rule written as a self-contained query, for `<link rel="preload" media>`. A `<source>` inherits
   * "everything wider already matched"; a preload link does not, so the mobile entry has to state its own ceiling
   * or every desktop visitor would preload the phone image as well as the one it actually uses.
   */
  preloadMedia: string;
  /** Plain-English breakpoint, for the admin screen. */
  range: string;
  /** What to upload. Also the cap the stored image is resized down to. */
  recommended: { width: number; height: number };
  /** Aspect as width / height, derived from `recommended` so the two can never disagree. */
  aspect: number;
  /** Below this the admin screen warns that the image will look soft. Not a rejection. */
  minWidth: number;
}

function spec(s: Omit<WelcomeCoverVariantSpec, "aspect">): WelcomeCoverVariantSpec {
  return { ...s, aspect: s.recommended.width / s.recommended.height };
}

export const WELCOME_COVER_VARIANTS: readonly WelcomeCoverVariantSpec[] = [
  spec({ key: "DESKTOP", label: "Desktop", media: "(min-width: 1280px)", preloadMedia: "(min-width: 1280px)", range: "1280px and wider", recommended: { width: 2560, height: 1440 }, minWidth: 1600 }),
  spec({ key: "TABLET", label: "Tablet", media: "(min-width: 768px)", preloadMedia: "(min-width: 768px) and (max-width: 1279.98px)", range: "768px to 1279px", recommended: { width: 1536, height: 2048 }, minWidth: 1024 }),
  spec({ key: "MOBILE", label: "Mobile", media: null, preloadMedia: "(max-width: 767.98px)", range: "under 768px", recommended: { width: 1080, height: 1920 }, minWidth: 720 }),
];

/** Upload order for the admin screen and for anything that reads left to right: phone first. */
export const WELCOME_COVER_VARIANTS_BY_DEVICE: readonly WelcomeCoverVariantSpec[] = [...WELCOME_COVER_VARIANTS].reverse();

export function variantSpec(key: WelcomeCoverVariantKey): WelcomeCoverVariantSpec {
  const found = WELCOME_COVER_VARIANTS.find((v) => v.key === key);
  if (!found) throw new Error(`Unknown welcome cover variant: ${key}`);
  return found;
}

export function isWelcomeCoverVariant(value: unknown): value is WelcomeCoverVariantKey {
  return value === "MOBILE" || value === "TABLET" || value === "DESKTOP";
}

/**
 * How far off the recommended shape an upload may be before the admin screen says so. Generous on purpose: the
 * point is to catch a landscape photo dropped into the mobile slot, not to police a few per cent of crop.
 */
export const ASPECT_TOLERANCE = 0.18;

export interface UploadWarning {
  code: "aspect" | "resolution";
  message: string;
}

/**
 * Warnings for an upload that was accepted. Nothing here rejects: an admin who wants an unusual crop gets it, and
 * finds out what it will cost before publishing rather than after.
 */
export function describeUploadWarnings(key: WelcomeCoverVariantKey, width: number, height: number): UploadWarning[] {
  const v = variantSpec(key);
  const warnings: UploadWarning[] = [];
  const aspect = width / height;
  if (Math.abs(aspect - v.aspect) / v.aspect > ASPECT_TOLERANCE) {
    warnings.push({
      code: "aspect",
      message: `This is ${formatRatio(aspect)}, and ${v.label} covers are ${formatRatio(v.aspect)} (${v.recommended.width}×${v.recommended.height}). It will still fill the screen, but more of it will be cropped away.`,
    });
  }
  if (width < v.minWidth) {
    warnings.push({
      code: "resolution",
      message: `${width}px wide is below the ${v.minWidth}px this slot wants, so it may look soft on ${v.label.toLowerCase()} screens.`,
    });
  }
  return warnings;
}

/** "9:16", "16:9", "3:4" — the nearest tidy ratio, for copy rather than for maths. */
export function formatRatio(aspect: number): string {
  const known: [number, number][] = [
    [9, 16],
    [3, 4],
    [2, 3],
    [1, 1],
    [4, 3],
    [3, 2],
    [16, 10],
    [16, 9],
    [21, 9],
  ];
  let best = known[0]!;
  for (const r of known) if (Math.abs(r[0] / r[1] - aspect) < Math.abs(best[0] / best[1] - aspect)) best = r;
  return `${best[0]}:${best[1]}`;
}

/** "1.4 MB", "820 KB" — file weights in the admin list. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

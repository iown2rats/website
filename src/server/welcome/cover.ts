/**
 * What the Welcome Screen actually paints (docs/ARCHITECTURE.md §26): one published cover chosen by the clock, with
 * every missing variant filled in from the built-in defaults.
 *
 * Read-side only. Nothing here writes, and nothing here can throw: the first screen a stranger sees must render
 * even when the database is unreachable, storage is down or a row points at artwork that no longer exists. Every
 * failure path lands on DEFAULT_COVER, which is part of the build.
 */
import { DEFAULT_COVER_SOURCES, type CoverImageSource } from "./defaults";
import { WELCOME_COVER_VARIANTS, type WelcomeCoverVariantKey } from "./variants";

/** Where a published cover image is served from. Immutable: the id changes whenever the artwork does. */
export function coverAssetUrl(assetId: string): string {
  return `/api/welcome-cover/${assetId}`;
}

export interface WelcomeCoverImage extends CoverImageSource {
  variant: WelcomeCoverVariantKey;
  /** `<source media>`; null marks the `<img>` fallback, which must be last. */
  media: string | null;
  /** The same rule as a standalone query, for `<link rel="preload" media>`. */
  preloadMedia: string;
  /** False when this slot fell back to the built-in default. */
  custom: boolean;
}

export interface WelcomeCoverView {
  /** The cover being shown, or null for the built-in defaults. */
  id: string | null;
  name: string | null;
  /** Widest first, `<img>` fallback last — the order `<picture>` needs. */
  images: WelcomeCoverImage[];
}

export const DEFAULT_COVER: WelcomeCoverView = {
  id: null,
  name: null,
  images: WELCOME_COVER_VARIANTS.map((v) => ({ ...DEFAULT_COVER_SOURCES[v.key], variant: v.key, media: v.media, preloadMedia: v.preloadMedia, custom: false })),
};

/** The asset columns a cover selection needs; shaped so tests can build one without a database. */
export interface CoverAssetRow {
  id: string;
  width: number;
  height: number;
  blurhash: string;
}

export interface CoverRow {
  id: string;
  name: string;
  mobileAsset: CoverAssetRow | null;
  tabletAsset: CoverAssetRow | null;
  desktopAsset: CoverAssetRow | null;
}

const ASSET_OF: Record<WelcomeCoverVariantKey, (c: CoverRow) => CoverAssetRow | null> = {
  MOBILE: (c) => c.mobileAsset,
  TABLET: (c) => c.tabletAsset,
  DESKTOP: (c) => c.desktopAsset,
};

/**
 * Turn a cover row into what the backdrop renders. PER VARIANT: a slot with no asset takes the default for THAT
 * device, never the campaign's image for another one. A cover whose three slots are all empty is indistinguishable
 * from no cover at all, which is what makes "Restore default" and "a draft nobody finished" behave the same way.
 */
export function coverView(cover: CoverRow | null): WelcomeCoverView {
  if (!cover) return DEFAULT_COVER;
  const images = WELCOME_COVER_VARIANTS.map((v): WelcomeCoverImage => {
    const asset = ASSET_OF[v.key](cover);
    if (!asset) return { ...DEFAULT_COVER_SOURCES[v.key], variant: v.key, media: v.media, preloadMedia: v.preloadMedia, custom: false };
    const url = coverAssetUrl(asset.id);
    return {
      variant: v.key,
      media: v.media,
      preloadMedia: v.preloadMedia,
      custom: true,
      // One stored file per upload, so the srcset has a single entry; the browser still needs the `w` descriptor
      // to be absent here, because a lone candidate with no descriptor is exactly "use this file".
      avifSrcSet: null,
      webpSrcSet: url,
      src: url,
      width: asset.width,
      height: asset.height,
      placeholder: blurhashDataUri(asset.blurhash),
    };
  });
  if (images.every((i) => !i.custom)) return DEFAULT_COVER;
  return { id: cover.id, name: cover.name, images };
}

/**
 * A blurhash cannot be a CSS `url()`, and decoding one on the server for every visit would cost more than it saves.
 * The placeholder for an uploaded cover is therefore a flat colour rather than a blur: the point of it is only that
 * the screen is never white for a frame, and a dark wash does that. Built-in covers keep their real blur, which is
 * baked into the build and costs nothing.
 */
export function blurhashDataUri(blurhash: string): string {
  const rgb = blurhashAverageColor(blurhash);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="rgb(${rgb[0]},${rgb[1]},${rgb[2]})"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

const B83 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

/**
 * The first 4 characters after the size flag of a blurhash encode the DC term: the average colour, sRGB, one byte
 * per channel. That is all this needs, so there is no decode and no dependency.
 */
export function blurhashAverageColor(blurhash: string): [number, number, number] {
  if (blurhash.length < 6) return [5, 13, 20];
  let value = 0;
  for (let i = 1; i < 6; i++) {
    const digit = B83.indexOf(blurhash[i]!);
    if (digit < 0) return [5, 13, 20];
    value = value * 83 + digit;
  }
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

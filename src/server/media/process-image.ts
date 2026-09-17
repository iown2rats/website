/**
 * Shared image pipeline (Phase 8): sniff the real format with sharp (the browser's MIME type is never trusted),
 * enforce size and dimension limits, apply EXIF orientation, re-encode to WebP (which drops all metadata,
 * including GPS) and compute a blurhash. Profile photos (src/server/photos/photos.ts) established these rules.
 */
import { encode as encodeBlurhash } from "blurhash";
import sharp, { type Metadata } from "sharp";
import { ValidationError } from "@/lib/errors";

export const IMAGE_RULES = {
  maxBytes: 8 * 1024 * 1024,
  minDimension: 400,
  allowedFormats: ["jpeg", "png", "webp"] as const,
} as const;

export interface ProcessedImage {
  full: Uint8Array;
  width: number;
  height: number;
  blurhash: string;
}

export async function processImage(bytes: Uint8Array, options: { maxWidth: number; maxHeight: number; quality?: number }): Promise<ProcessedImage> {
  if (bytes.byteLength === 0) throw new ValidationError("That file is empty.");
  if (bytes.byteLength > IMAGE_RULES.maxBytes) throw new ValidationError("That photo is too large. Choose one under 8 MB.");
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new ValidationError("That file isn't a photo we can use. Try a JPG, PNG or WebP.");
  }
  if (!meta.format || !(IMAGE_RULES.allowedFormats as readonly string[]).includes(meta.format)) {
    throw new ValidationError("That file isn't a photo we can use. Try a JPG, PNG or WebP.");
  }
  if ((meta.width ?? 0) < IMAGE_RULES.minDimension || (meta.height ?? 0) < IMAGE_RULES.minDimension) {
    throw new ValidationError(`That photo is too small. Use one at least ${IMAGE_RULES.minDimension} px wide and tall.`);
  }
  const base = sharp(bytes, { limitInputPixels: 50_000_000 }).rotate();
  const full = await base.clone().resize({ width: options.maxWidth, height: options.maxHeight, fit: "inside", withoutEnlargement: true }).webp({ quality: options.quality ?? 82 }).toBuffer({ resolveWithObject: true });
  const tiny = await base.clone().resize(32, 32, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const blurhash = encodeBlurhash(new Uint8ClampedArray(tiny.data), tiny.info.width, tiny.info.height, 4, 3);
  return { full: new Uint8Array(full.data), width: full.info.width, height: full.info.height, blurhash };
}

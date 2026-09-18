/**
 * An OCR-only derivative of the stored receipt: EXIF orientation applied, greyscale, contrast normalised, upscaled
 * when a phone screenshot is small, PNG (lossless) so Tesseract does not fight WebP artefacts. It is never stored:
 * the admin always sees the re-encoded original, and this buffer dies with the request.
 */
import sharp from "sharp";

export const PREPROCESS = {
  minWidth: 1400,
  maxWidth: 2400,
} as const;

export async function prepareForOcr(image: Uint8Array): Promise<Uint8Array> {
  const meta = await sharp(image, { limitInputPixels: 50_000_000 }).metadata();
  let pipeline = sharp(image, { limitInputPixels: 50_000_000 }).rotate().grayscale().normalise();
  const width = meta.width ?? 0;
  if (width && width < PREPROCESS.minWidth) pipeline = pipeline.resize({ width: PREPROCESS.minWidth, kernel: "lanczos3" });
  else if (width > PREPROCESS.maxWidth) pipeline = pipeline.resize({ width: PREPROCESS.maxWidth });
  const out = await pipeline.png({ compressionLevel: 6 }).toBuffer();
  return new Uint8Array(out);
}

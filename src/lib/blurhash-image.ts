import { decode, isBlurhashValid } from "blurhash";

/*
 * A blurhash as something the browser can paint on the FIRST frame, for locked photos (docs/ARCHITECTURE.md §12.18).
 *
 * The hash used to be painted onto a <canvas> in an effect, which left the tile transparent until the effect ran and
 * whenever a canvas inside a moving, rounded, clipped layer failed to composite. These two helpers remove the canvas:
 *  - `blurhashAverageColor` reads the hash's DC term, the photo's average colour, straight out of the string. It is
 *    the tile's opaque base, so the surface is solid before anything is decoded.
 *  - `blurhashDataUrl` decodes the hash into a tiny bitmap and returns it as a data URL, usable as a CSS background
 *    in render, on the server and the client alike (it is deterministic, so hydration matches).
 * Neither reveals more than the hash already does: the hash is all the server ever sends for a locked photo.
 */

const BASE83 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function decode83(s: string): number {
  let v = 0;
  for (const ch of s) {
    const d = BASE83.indexOf(ch);
    if (d < 0) return -1;
    v = v * 83 + d;
  }
  return v;
}

/** The photo's average colour as `rgb(r, g, b)`, or null for a missing or malformed hash. */
export function blurhashAverageColor(hash: string | null | undefined): string | null {
  if (!hash || !isBlurhashValid(hash).result) return null;
  const v = decode83(hash.slice(2, 6));
  if (v < 0) return null;
  return `rgb(${v >> 16}, ${(v >> 8) & 255}, ${v & 255})`;
}

/**
 * A 24-bit BMP, the simplest format every browser decodes, with no compression step to write. 32×42 pixels at
 * 96 bytes a row is about 4 KB, 5.4 KB as base64.
 */
function bmpDataUrl(rgba: Uint8ClampedArray, width: number, height: number): string {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const bytes = new Uint8Array(54 + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42; // "B"
  bytes[1] = 0x4d; // "M"
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true); // pixel data offset
  view.setUint32(14, 40, true); // BITMAPINFOHEADER
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: rows stored bottom-up
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, pixelBytes, true);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = row + x * 3;
      bytes[dst] = rgba[src + 2]!;
      bytes[dst + 1] = rgba[src + 1]!;
      bytes[dst + 2] = rgba[src]!;
    }
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/bmp;base64,${btoa(bin)}`;
}

// A deck holds a handful of cards and each has a few photos; this is only a guard against unbounded growth.
const CACHE_LIMIT = 64;
const cache = new Map<string, string | null>();

/**
 * The hash decoded to a `width`×`height` bitmap as a data URL, or null for a missing or malformed hash. `punch`
 * below 1 flattens the hash's contrast further, so what is left is colour and nothing that reads as a shape.
 */
export function blurhashDataUrl(hash: string | null | undefined, width = 32, height = 42, punch = 1): string | null {
  if (!hash) return null;
  const key = `${hash}|${width}|${height}|${punch}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url: string | null = null;
  try {
    if (isBlurhashValid(hash).result) url = bmpDataUrl(decode(hash, width, height, punch), width, height);
  } catch {
    url = null;
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, url);
  return url;
}

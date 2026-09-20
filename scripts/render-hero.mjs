/**
 * Renders the built-in Welcome Screen covers from the master photograph into responsive AVIF + WebP files under
 * public/hero, and prints the inline placeholders used by src/server/welcome/defaults.ts. Run after replacing a
 * master:
 *   node scripts/render-hero.mjs
 *
 * Three art directions, because one photograph cannot be the right shape for a phone held upright AND a desktop
 * window (src/server/welcome/variants.ts): a 9:16 mobile frame, a 3:4 tablet crop and a 16:9 desktop crop. Admins
 * upload their own three for a promotion; these are the permanent fallback each variant drops back to, per device,
 * so a promotion with no desktop artwork shows the desktop default rather than a stretched phone image.
 *
 * The crops are taken from the SINGLE portrait master (941 x 1672 — the largest original that exists), positioned
 * by hand: `focus` is where the chosen band sits in the leftover height, picked so the couple and the horizon stay
 * in frame. A landscape master would let the desktop crop be sharper than a 941 px wide band can be; until there is
 * one, cropping first is still better than letting the browser cover-crop the full portrait frame, which upscales
 * the same pixels and downloads three times the bytes to do it.
 */
import { statSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import sharp from "sharp";

const MASTER = "docs/assets/hero/night-beach-master.png";
const OUT = "public/hero";

/** aspect: width / height. focus: 0 = top of the master, 1 = bottom, applied to the height the crop discards. */
const VARIANTS = [
  { name: "mobile", aspect: 9 / 16, focus: 0.5, widths: [480, 640, 828, 941] },
  { name: "tablet", aspect: 3 / 4, focus: 0.55, widths: [640, 768, 941] },
  { name: "desktop", aspect: 16 / 9, focus: 0.75, widths: [941] },
];

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.startsWith("night-beach-") || f.startsWith("default-")) unlinkSync(`${OUT}/${f}`);

const master = sharp(MASTER).rotate();
const { width: mw, height: mh } = await master.metadata();
const rows = [];
const placeholders = {};

for (const v of VARIANTS) {
  // Crop the tallest band of this aspect that fits the master, then place it with `focus`.
  let cw = mw;
  let ch = Math.round(mw / v.aspect);
  if (ch > mh) {
    ch = mh;
    cw = Math.round(mh * v.aspect);
  }
  const top = Math.round((mh - ch) * v.focus);
  const left = Math.round((mw - cw) * 0.5);
  const cropped = sharp(MASTER).rotate().extract({ left, top, width: cw, height: ch });
  for (const w of v.widths) {
    const base = cropped.clone().resize({ width: w, withoutEnlargement: true });
    const avif = `${OUT}/default-${v.name}-${w}.avif`;
    const webp = `${OUT}/default-${v.name}-${w}.webp`;
    await base.clone().avif({ quality: 52, effort: 6 }).toFile(avif);
    await base.clone().webp({ quality: 80, effort: 6 }).toFile(webp);
    const meta = await sharp(avif).metadata();
    rows.push({ variant: v.name, width: meta.width, height: meta.height, avifKiB: +(statSync(avif).size / 1024).toFixed(1), webpKiB: +(statSync(webp).size / 1024).toFixed(1) });
  }
  const tiny = await cropped.clone().resize({ width: 24 }).blur(1).webp({ quality: 40 }).toBuffer();
  placeholders[v.name] = `data:image/webp;base64,${tiny.toString("base64")}`;
}

writeFileSync(`${OUT}/.placeholders.json`, JSON.stringify(placeholders, null, 2));
console.table(rows);
console.log(`placeholders written to ${OUT}/.placeholders.json — paste into DEFAULT_PLACEHOLDERS in src/server/welcome/defaults.ts`);

/**
 * Renders the welcome-screen hero from the master photograph into responsive AVIF + WebP files under public/hero
 * and prints the inline placeholder used by src/app/page.tsx. Run after replacing the master:
 *   node scripts/render-hero.mjs
 */
import { statSync, writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const MASTER = "docs/assets/hero/night-beach-master.png";
const OUT = "public/hero";
const WIDTHS = [480, 640, 828, 941];

mkdirSync(OUT, { recursive: true });
const rows = [];
for (const w of WIDTHS) {
  const base = sharp(MASTER).rotate().resize({ width: w, withoutEnlargement: true });
  const avif = `${OUT}/night-beach-${w}.avif`;
  const webp = `${OUT}/night-beach-${w}.webp`;
  await base.clone().avif({ quality: 52, effort: 6 }).toFile(avif);
  await base.clone().webp({ quality: 80, effort: 6 }).toFile(webp);
  const { height } = await sharp(avif).metadata();
  rows.push({ width: w, height, avifBytes: statSync(avif).size, webpBytes: statSync(webp).size });
}
const tiny = await sharp(MASTER).resize({ width: 24 }).blur(1).webp({ quality: 40 }).toBuffer();
writeFileSync(`${OUT}/.placeholder.txt`, `data:image/webp;base64,${tiny.toString("base64")}`);
console.table(rows);
console.log(`placeholder (${tiny.length} bytes) written to ${OUT}/.placeholder.txt — paste into HERO_PLACEHOLDER in src/app/page.tsx`);

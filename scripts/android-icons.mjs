/*
 * Android launcher icons from the approved MelloCrush brand assets (docs/ARCHITECTURE.md §28).
 *
 * Run from the repository root — `node scripts/android-icons.mjs` — because sharp is a dependency of the website,
 * not of mobile/. Re-run it only if the brand artwork in src/assets/brand changes; the output is committed. No redesign: the square/round icons are the
 * shipped app icon verbatim, and the adaptive foreground is the shipped mark, untouched apart from being scaled
 * into the 66% safe zone Android's masks require.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const RES = "mobile/android/app/src/main/res";
const APP_ICON = "src/assets/brand/mellocrush-app-icon-512.png";
const MARK = "src/assets/brand/mellocrush-mark-512.png";
const CREAM = { r: 255, g: 251, b: 241, alpha: 1 };

/** Legacy launcher sizes, and the adaptive foreground's own (108dp at each density). */
const DENSITIES = [
  { dir: "mipmap-mdpi", legacy: 48, adaptive: 108 },
  { dir: "mipmap-hdpi", legacy: 72, adaptive: 162 },
  { dir: "mipmap-xhdpi", legacy: 96, adaptive: 216 },
  { dir: "mipmap-xxhdpi", legacy: 144, adaptive: 324 },
  { dir: "mipmap-xxxhdpi", legacy: 192, adaptive: 432 },
];

/** Android masks a 108dp canvas down to roughly 72dp; 60% keeps the mark clear of every mask shape. */
const SAFE_FRACTION = 0.6;

for (const { dir, legacy, adaptive } of DENSITIES) {
  await mkdir(`${RES}/${dir}`, { recursive: true });

  const square = await sharp(APP_ICON).resize(legacy, legacy, { fit: "cover" }).png().toBuffer();
  await sharp(square).toFile(`${RES}/${dir}/ic_launcher.png`);
  // The round icon is the same artwork; the launcher applies the circular mask itself.
  await sharp(square).toFile(`${RES}/${dir}/ic_launcher_round.png`);

  const inner = Math.round(adaptive * SAFE_FRACTION);
  const mark = await sharp(MARK).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const pad = Math.round((adaptive - inner) / 2);
  await sharp({ create: { width: adaptive, height: adaptive, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, top: pad, left: pad }])
    .png()
    .toFile(`${RES}/${dir}/ic_launcher_foreground.png`);

  console.log(`${dir}: legacy ${legacy}px, adaptive ${adaptive}px (mark ${inner}px)`);
}

// The adaptive background is the brand's own page colour, so the icon reads as one piece under every mask.
const { promises: fs } = await import("node:fs");
await fs.writeFile(
  `${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <!-- MelloCrush page cream. Matches --background in src/styles/tokens.css. -->\n    <color name="ic_launcher_background">#FFFBF1</color>\n</resources>\n`,
);
console.log(`background: rgb(${CREAM.r} ${CREAM.g} ${CREAM.b}) written to values/ic_launcher_background.xml`);

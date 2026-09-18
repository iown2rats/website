import type { NextConfig } from "next";

/**
 * OCR runs server-side with tesseract.js (docs/ARCHITECTURE.md §12.14, docs/DEPLOYMENT.md §7). The package spawns a
 * worker thread from a file path and loads a wasm core plus the English model from disk, none of which a bundler can
 * see, so it stays a plain Node dependency and its files are traced into the functions that read receipts.
 */
const OCR_ASSETS = [
  "node_modules/tesseract.js/src/**/*",
  "node_modules/tesseract.js/package.json",
  "node_modules/tesseract.js-core/*lstm*",
  "node_modules/tesseract.js-core/index.js",
  "node_modules/tesseract.js-core/package.json",
  "node_modules/@tesseract.js-data/eng/4.0.0_best_int/**/*",
  "node_modules/@tesseract.js-data/eng/package.json",
  "node_modules/wasm-feature-detect/**/*",
  "node_modules/zlibjs/**/*",
  "node_modules/is-url/**/*",
  "node_modules/bmp-js/**/*",
  "node_modules/idb-keyval/**/*",
  "node_modules/regenerator-runtime/**/*",
  "node_modules/node-fetch/**/*",
  "node_modules/whatwg-url/**/*",
  "node_modules/tr46/**/*",
  "node_modules/webidl-conversions/**/*",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng"],
  async headers() {
    return [
      {
        // Welcome-screen hero (public/hero, rendered by scripts/render-hero.mjs). Vercel's default for public files is
        // max-age=0 + revalidation on every visit; the hero is the largest-contentful-paint image, so let browsers keep
        // it for a week. Rename the files (scripts/render-hero.mjs) when the photograph changes.
        source: "/hero/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
  outputFileTracingIncludes: {
    // Customer upload (OCR at attach) and the admin payment detail (server action "Re-run OCR"). Keys are picomatch
    // route globs, so the dynamic segment is written as `*` rather than `[orderId]` (which would be a character class).
    "/api/payments/*/receipt": OCR_ASSETS,
    "/admin/payments/*": OCR_ASSETS,
  },
};

export default nextConfig;

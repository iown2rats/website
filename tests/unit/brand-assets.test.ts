import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The brand assets must stay fingerprinted (docs/DESIGN_SYSTEM.md §34).
 *
 * The logo shipped once from `public/brand/*.png` at fixed URLs. Files in `public/` are served
 * `cache-control: public, max-age=0, must-revalidate`, which iOS Safari treats as a suggestion, so replacing the
 * artwork under the same path left the previous logo on screen for anyone who had already loaded it — on the admin
 * portal, where it was noticed, and silently for every member who had visited before.
 *
 * Importing the files instead makes the bundler hash the contents into the URL: new artwork, new URL, no stale copy
 * anywhere. This guards that, because the mistake is invisible in a diff and only shows up on somebody else's phone.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const BRAND_DIR = path.join(ROOT, "src/assets/brand");

/** Every module allowed to name a brand image, and the artwork it is expected to reach for. */
const CONSUMERS = ["src/components/brand/logo.tsx", "src/app/manifest.ts"];

describe("brand assets are content-addressed", () => {
  it("keeps the artwork out of public/, where URLs are fixed", () => {
    expect(
      existsSync(path.join(ROOT, "public/brand")),
      "brand artwork is back in public/ — a fixed URL lets a browser keep showing the previous logo",
    ).toBe(false);
  });

  it("is reached by import, never by a literal path", () => {
    for (const file of CONSUMERS) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      // Comments are stripped first: this file's own explanation of the bug quotes the old `/brand/...` path.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, `${file} names a brand image by URL instead of importing it`).not.toMatch(/["'`]\/brand\//);
      expect(code, `${file} no longer imports the brand artwork`).toMatch(/from "@\/assets\/brand\//);
    }
  });

  it("still ships every size the app and the manifest ask for", () => {
    for (const asset of [
      "mellocrush-logo-480.png",
      "mellocrush-logo-white-480.png",
      "mellocrush-mark.png",
      "mellocrush-app-icon-192.png",
      "mellocrush-app-icon-512.png",
    ]) {
      expect(existsSync(path.join(BRAND_DIR, asset)), `${asset} is missing from src/assets/brand`).toBe(true);
    }
    // Next fingerprints these two itself through the file-based metadata convention.
    expect(existsSync(path.join(ROOT, "src/app/icon.png"))).toBe(true);
    expect(existsSync(path.join(ROOT, "src/app/apple-icon.png"))).toBe(true);
  });

  it("derives every asset from the supplied artwork, so a size cannot drift", () => {
    for (const source of ["brand-source/mellocrush-wordmark.png", "brand-source/mellocrush-mark.png"]) {
      expect(existsSync(path.join(ROOT, source)), `${source} is gone, so the assets can no longer be regenerated`).toBe(true);
    }
    const script = readFileSync(path.join(ROOT, "scripts/build-brand-assets.py"), "utf8");
    expect(script).toContain('BRAND = ROOT / "src" / "assets" / "brand"');
  });
});

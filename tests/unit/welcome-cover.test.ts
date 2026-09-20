/**
 * Welcome Screen covers, the parts with no database in them (docs/ARCHITECTURE.md §26): the art-direction contract
 * the browser is handed, per-device fallback, upload warnings and the derived states.
 */
import { describe, expect, it } from "vitest";
import { blurhashAverageColor, coverView, DEFAULT_COVER, type CoverRow } from "@/server/welcome/cover";
import { DEFAULT_COVER_SOURCES } from "@/server/welcome/defaults";
import { describeCoverState } from "@/server/welcome/admin-covers";
import { describeUploadWarnings, formatBytes, formatRatio, isWelcomeCoverVariant, WELCOME_COVER_VARIANTS, variantSpec } from "@/server/welcome/variants";

const asset = (id: string) => ({ id, width: 1080, height: 1920, blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4" });
const cover = (o: Partial<CoverRow> = {}): CoverRow => ({ id: "c1", name: "Promo", mobileAsset: null, tabletAsset: null, desktopAsset: null, ...o });

describe("variant contract", () => {
  it("runs widest first and ends with the one <picture> falls back to", () => {
    expect(WELCOME_COVER_VARIANTS.map((v) => v.key)).toEqual(["DESKTOP", "TABLET", "MOBILE"]);
    expect(WELCOME_COVER_VARIANTS.slice(0, -1).every((v) => v.media !== null)).toBe(true);
    // The last entry MUST have no media query: it becomes the <img>, which is the only required child.
    expect(WELCOME_COVER_VARIANTS.at(-1)!.media).toBeNull();
  });

  it("uses the breakpoints the rest of the app uses, and preload queries that never overlap", () => {
    expect(variantSpec("DESKTOP").media).toBe("(min-width: 1280px)");
    expect(variantSpec("TABLET").media).toBe("(min-width: 768px)");
    // Each preload link stands alone, so a desktop visitor cannot also preload the phone image.
    expect(variantSpec("MOBILE").preloadMedia).toBe("(max-width: 767.98px)");
    expect(variantSpec("TABLET").preloadMedia).toBe("(min-width: 768px) and (max-width: 1279.98px)");
    expect(variantSpec("DESKTOP").preloadMedia).toBe("(min-width: 1280px)");
  });

  it("recommends the requested sizes, and derives the aspect from them", () => {
    expect(variantSpec("MOBILE").recommended).toEqual({ width: 1080, height: 1920 });
    expect(variantSpec("TABLET").recommended).toEqual({ width: 1536, height: 2048 });
    expect(variantSpec("DESKTOP").recommended).toEqual({ width: 2560, height: 1440 });
    expect(formatRatio(variantSpec("MOBILE").aspect)).toBe("9:16");
    expect(formatRatio(variantSpec("TABLET").aspect)).toBe("3:4");
    expect(formatRatio(variantSpec("DESKTOP").aspect)).toBe("16:9");
  });

  it("rejects anything that is not one of the three", () => {
    expect(isWelcomeCoverVariant("MOBILE")).toBe(true);
    expect(isWelcomeCoverVariant("WATCH")).toBe(false);
    expect(isWelcomeCoverVariant(null)).toBe(false);
  });
});

describe("upload warnings", () => {
  it("accepts the recommended size with nothing to say", () => {
    expect(describeUploadWarnings("MOBILE", 1080, 1920)).toEqual([]);
    expect(describeUploadWarnings("DESKTOP", 2560, 1440)).toEqual([]);
  });

  it("warns, rather than refusing, when a landscape photo lands in the mobile slot", () => {
    const warnings = describeUploadWarnings("MOBILE", 1920, 1080);
    expect(warnings.map((w) => w.code)).toContain("aspect");
    expect(warnings[0]!.message).toContain("still fill the screen");
  });

  it("warns about resolution below what the slot needs", () => {
    expect(describeUploadWarnings("DESKTOP", 1200, 675).map((w) => w.code)).toContain("resolution");
    expect(describeUploadWarnings("MOBILE", 600, 1067).map((w) => w.code)).toContain("resolution");
    // 900px is above the mobile floor, so nothing is said — the warning is about softness, not about taste.
    expect(describeUploadWarnings("MOBILE", 900, 1600)).toEqual([]);
  });

  it("tolerates a few per cent of crop without complaining", () => {
    expect(describeUploadWarnings("MOBILE", 1080, 2000)).toEqual([]);
  });
});

describe("per-device fallback", () => {
  it("falls back to the built-in cover when nothing is published", () => {
    expect(coverView(null)).toBe(DEFAULT_COVER);
    expect(DEFAULT_COVER.images.every((i) => !i.custom)).toBe(true);
  });

  it("fills EACH missing slot from that device's default, never from the variant that was supplied", () => {
    const view = coverView(cover({ mobileAsset: asset("m1"), tabletAsset: asset("t1") }));
    const byVariant = Object.fromEntries(view.images.map((i) => [i.variant, i]));
    expect(byVariant.MOBILE!.custom).toBe(true);
    expect(byVariant.TABLET!.custom).toBe(true);
    // The one the promotion has no artwork for: the DESKTOP default, not the mobile or tablet upload.
    expect(byVariant.DESKTOP!.custom).toBe(false);
    expect(byVariant.DESKTOP!.src).toBe(DEFAULT_COVER_SOURCES.DESKTOP.src);
    expect(byVariant.DESKTOP!.src).not.toBe(byVariant.MOBILE!.src);
  });

  it("serves each uploaded variant from its own immutable url", () => {
    const view = coverView(cover({ mobileAsset: asset("m1"), desktopAsset: asset("d1") }));
    const byVariant = Object.fromEntries(view.images.map((i) => [i.variant, i]));
    expect(byVariant.MOBILE!.src).toBe("/api/welcome-cover/m1");
    expect(byVariant.DESKTOP!.src).toBe("/api/welcome-cover/d1");
    // A single stored file, so the srcset is that one candidate with no width descriptor.
    expect(byVariant.MOBILE!.webpSrcSet).toBe("/api/welcome-cover/m1");
    expect(byVariant.MOBILE!.avifSrcSet).toBeNull();
  });

  it("treats a cover with no artwork at all as no cover", () => {
    expect(coverView(cover())).toBe(DEFAULT_COVER);
  });

  it("keeps the images in <picture> order whatever is custom", () => {
    const view = coverView(cover({ tabletAsset: asset("t1") }));
    expect(view.images.map((i) => i.variant)).toEqual(["DESKTOP", "TABLET", "MOBILE"]);
    expect(view.images.at(-1)!.media).toBeNull();
  });

  it("gives every image an intrinsic size, so the backdrop cannot shift when it loads", () => {
    for (const img of coverView(cover({ mobileAsset: asset("m1") })).images) {
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
      expect(img.placeholder.startsWith("data:")).toBe(true);
    }
  });
});

describe("blurhash average colour", () => {
  it("reads the DC term without decoding the whole hash", () => {
    const [r, g, b] = blurhashAverageColor("L6PZfSi_.AyE_3t7t7R**0o#DgR4");
    for (const c of [r, g, b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
  });

  it("falls back to the page colour rather than throwing on rubbish", () => {
    expect(blurhashAverageColor("")).toEqual([5, 13, 20]);
    expect(blurhashAverageColor("!!!!!!")).toEqual([5, 13, 20]);
  });
});

describe("derived state", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const past = new Date("2026-09-19T12:00:00Z");
  const future = new Date("2026-09-21T12:00:00Z");
  const row = (o: Partial<{ status: string; startsAt: Date | null; endsAt: Date | null; id: string }>) => ({ status: "PUBLISHED", startsAt: null, endsAt: null, id: "c1", ...o });

  it("reads a draft as a draft whatever its dates say", () => {
    expect(describeCoverState(row({ status: "DRAFT", startsAt: past }), "c1", now)).toBe("DRAFT");
  });

  it("reads a future start as scheduled and a past end as expired", () => {
    expect(describeCoverState(row({ startsAt: future }), null, now)).toBe("SCHEDULED");
    expect(describeCoverState(row({ endsAt: past }), null, now)).toBe("EXPIRED");
  });

  it("expiry beats a start date that has also passed", () => {
    expect(describeCoverState(row({ startsAt: past, endsAt: past }), null, now)).toBe("EXPIRED");
  });

  it("only the cover selection actually picked reads LIVE", () => {
    expect(describeCoverState(row({ id: "c1" }), "c1", now)).toBe("LIVE");
    expect(describeCoverState(row({ id: "c2" }), "c1", now)).toBe("SUPERSEDED");
  });
});

describe("formatting", () => {
  it("writes file weights the way a person reads them", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1024 * 300)).toBe("300 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
  });
});

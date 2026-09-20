/**
 * Welcome Screen covers end to end (docs/ARCHITECTURE.md §26): who may manage them, what an upload is allowed to
 * be, that a draft is invisible to visitors, publishing, scheduling and expiry, the overlap rule, Restore default,
 * history and republishing, and that the screen still works when everything behind it fails.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { AUDIT_ACTIONS } from "@/server/admin/audit";
import { hasPermission, type AdminActor } from "@/server/admin/authz";
import {
  archiveWelcomeCover,
  createWelcomeCover,
  describeCoverState,
  listWelcomeCovers,
  publishWelcomeCover,
  removeCoverAsset,
  restoreDefaultWelcomeCover,
  updateWelcomeCover,
  uploadCoverAsset,
} from "@/server/welcome/admin-covers";
import { getActiveWelcomeCover, liveCoverId } from "@/server/welcome/active-cover";
import { DEFAULT_COVER } from "@/server/welcome/cover";
import { DEFAULT_COVER_SOURCES } from "@/server/welcome/defaults";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { createStaff } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-20T12:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage-welcome", "w".repeat(32));
const deps = { db, storage, now: T0 };

async function admin(role: "ADMIN" | "MODERATOR" = "ADMIN"): Promise<AdminActor> {
  const s = await createStaff(db, { role, now: T0 });
  return { userId: s.userId, role };
}

/** A real encoded image of the given size, so sharp sniffs a genuine format rather than a stub. */
async function image(width: number, height: number, format: "jpeg" | "png" | "webp" = "jpeg"): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 12, g: 40, b: 70 } } })
    [format]()
    .toBuffer();
  return new Uint8Array(buf);
}

async function coverWith(variants: Partial<Record<"MOBILE" | "TABLET" | "DESKTOP", [number, number]>>, name = "Promo") {
  const a = await admin();
  const cover = await createWelcomeCover(a, { name }, { db, now: T0 });
  for (const [variant, [w, h]] of Object.entries(variants)) {
    await uploadCoverAsset(a, { coverId: cover.id, variant, bytes: await image(w, h), size: 1000 }, deps);
  }
  return { admin: a, coverId: cover.id };
}

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("authorization", () => {
  it("is an ADMIN permission that a moderator does not hold", () => {
    expect(hasPermission("ADMIN", "welcome-cover.manage")).toBe(true);
    expect(hasPermission("MODERATOR", "welcome-cover.manage")).toBe(false);
  });

  it("records who did it, so the front page is never anonymous", async () => {
    const a = await admin();
    const cover = await createWelcomeCover(a, { name: "Eid" }, { db, now: T0 });
    const entry = await db.auditLog.findFirst({ where: { action: AUDIT_ACTIONS.welcomeCoverCreated } });
    expect(entry?.actorId).toBe(a.userId);
    expect(entry?.targetId).toBe(cover.id);
    expect(cover.createdBy).toContain("@");
  });
});

describe("upload validation", () => {
  it("accepts JPG, PNG and WebP", async () => {
    const a = await admin();
    for (const format of ["jpeg", "png", "webp"] as const) {
      const cover = await createWelcomeCover(a, { name: format }, { db, now: T0 });
      const saved = await uploadCoverAsset(a, { coverId: cover.id, variant: "MOBILE", bytes: await image(1080, 1920, format), size: 1000 }, deps);
      expect(saved.assets.MOBILE).not.toBeNull();
    }
  });

  it("refuses a file that is not an image, whatever the browser called it", async () => {
    const { admin: a, coverId } = await coverWith({});
    const notAnImage = new Uint8Array(Buffer.from("GIF89a this is not really an image at all", "utf8"));
    await expect(uploadCoverAsset(a, { coverId, variant: "MOBILE", bytes: notAnImage, size: notAnImage.byteLength }, deps)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a PDF with an accurate message rather than a generic failure", async () => {
    const { admin: a, coverId } = await coverWith({});
    const pdf = new Uint8Array(Buffer.from("%PDF-1.7\nnot an image", "utf8"));
    await expect(uploadCoverAsset(a, { coverId, variant: "MOBILE", bytes: pdf, size: pdf.byteLength }, deps)).rejects.toThrow(/PDF/);
  });

  it("refuses an empty file and one over the size cap, checking the real length as well as the declared one", async () => {
    const { admin: a, coverId } = await coverWith({});
    await expect(uploadCoverAsset(a, { coverId, variant: "MOBILE", bytes: new Uint8Array(0), size: 0 }, deps)).rejects.toBeInstanceOf(ValidationError);
    await expect(uploadCoverAsset(a, { coverId, variant: "MOBILE", bytes: await image(1080, 1920), size: 99_000_000 }, deps)).rejects.toThrow(/under 8 MB/);
  });

  it("refuses a variant it does not have a slot for", async () => {
    const { admin: a, coverId } = await coverWith({});
    await expect(uploadCoverAsset(a, { coverId, variant: "WATCH", bytes: await image(1080, 1920), size: 1000 }, deps)).rejects.toBeInstanceOf(ValidationError);
  });

  it("caps the stored image at the variant's recommended size and re-encodes it to WebP", async () => {
    const { admin: a, coverId } = await coverWith({});
    const saved = await uploadCoverAsset(a, { coverId, variant: "DESKTOP", bytes: await image(5000, 2813), size: 1000 }, deps);
    expect(saved.assets.DESKTOP!.width).toBeLessThanOrEqual(2560);
    const row = await db.welcomeCoverAsset.findFirstOrThrow({ where: { id: saved.assets.DESKTOP!.id } });
    expect(row.storageKey).toBe(`welcome-covers/${row.id}.webp`);
    const bytes = await storage.read(row.storageKey);
    expect((await sharp(Buffer.from(bytes!)).metadata()).format).toBe("webp");
  });

  it("warns about a bad shape instead of refusing it", async () => {
    const { admin: a, coverId } = await coverWith({});
    const saved = await uploadCoverAsset(a, { coverId, variant: "MOBILE", bytes: await image(1920, 1080), size: 1000 }, deps);
    expect(saved.assets.MOBILE!.warnings.map((w) => w.code)).toContain("aspect");
  });

  it("gives every upload a fresh key, so replacing artwork can never serve the old bytes from a cache", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920] });
    const first = (await listWelcomeCovers({ db, now: T0 })).covers[0]!.assets.MOBILE!;
    const second = await uploadCoverAsset(a, { coverId, variant: "MOBILE", bytes: await image(1080, 1920, "png"), size: 1000 }, deps);
    expect(second.assets.MOBILE!.id).not.toBe(first.id);
    expect(second.assets.MOBILE!.url).not.toBe(first.url);
  });
});

describe("a draft is not public", () => {
  it("shows visitors the built-in cover while a cover with artwork sits in draft", async () => {
    await coverWith({ MOBILE: [1080, 1920], TABLET: [1536, 2048], DESKTOP: [2560, 1440] });
    expect(await liveCoverId(db, T0)).toBeNull();
    expect(await getActiveWelcomeCover(db, T0)).toBe(DEFAULT_COVER);
  });

  it("refuses to publish a cover with no artwork, which would look like a promotion and show the default", async () => {
    const { admin: a, coverId } = await coverWith({});
    await expect(publishWelcomeCover(a, coverId, { db, now: T0 })).rejects.toThrow(/at least one image/);
  });
});

describe("publishing", () => {
  it("puts the cover on air immediately when it has no start date", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920] });
    const published = await publishWelcomeCover(a, coverId, { db, now: T0 });
    expect(published.state).toBe("LIVE");
    const view = await getActiveWelcomeCover(db, T0);
    expect(view.id).toBe(coverId);
    expect(view.images.find((i) => i.variant === "MOBILE")!.custom).toBe(true);
  });

  it("serves each variant the browser will ask for, in <picture> order", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920], TABLET: [1536, 2048], DESKTOP: [2560, 1440] });
    await publishWelcomeCover(a, coverId, { db, now: T0 });
    const view = await getActiveWelcomeCover(db, T0);
    expect(view.images.map((i) => i.variant)).toEqual(["DESKTOP", "TABLET", "MOBILE"]);
    expect(view.images.map((i) => i.media)).toEqual(["(min-width: 1280px)", "(min-width: 768px)", null]);
    expect(new Set(view.images.map((i) => i.src)).size).toBe(3);
  });
});

describe("scheduling and expiry", () => {
  it("does not show a scheduled cover before it starts, and shows it afterwards without anything being deployed", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920] });
    const starts = new Date("2026-09-25T00:00:00Z");
    await updateWelcomeCover(a, { coverId, startsAt: starts.toISOString(), endsAt: null }, { db, now: T0 });
    await publishWelcomeCover(a, coverId, { db, now: T0 });

    expect(await liveCoverId(db, T0)).toBeNull();
    expect(await liveCoverId(db, new Date("2026-09-24T23:59:00Z"))).toBeNull();
    // Nothing ran in between: the same row, read a moment later, is simply live.
    expect(await liveCoverId(db, starts)).toBe(coverId);
  });

  it("stops showing a cover the moment its end passes", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920] });
    const ends = new Date("2026-09-30T00:00:00Z");
    await updateWelcomeCover(a, { coverId, startsAt: null, endsAt: ends.toISOString() }, { db, now: T0 });
    await publishWelcomeCover(a, coverId, { db, now: T0 });
    expect(await liveCoverId(db, new Date("2026-09-29T23:59:00Z"))).toBe(coverId);
    expect(await liveCoverId(db, ends)).toBeNull();
    expect(await getActiveWelcomeCover(db, ends)).toBe(DEFAULT_COVER);
  });

  it("refuses an end date that is not after the start", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920] });
    await expect(updateWelcomeCover(a, { coverId, startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a date it cannot read rather than silently storing nothing", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920] });
    await expect(updateWelcomeCover(a, { coverId, startsAt: "next tuesday-ish" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("overlapping schedules are deterministic", () => {
  it("a scheduled promotion beats an evergreen cover that is also published", async () => {
    const evergreen = await coverWith({ MOBILE: [1080, 1920] }, "Evergreen");
    await publishWelcomeCover(evergreen.admin, evergreen.coverId, { db, now: T0 });
    const promo = await coverWith({ MOBILE: [1080, 1920] }, "Promo");
    await updateWelcomeCover(promo.admin, { coverId: promo.coverId, startsAt: "2026-09-20T06:00:00Z" }, { db, now: T0 });
    await publishWelcomeCover(promo.admin, promo.coverId, { db, now: T0 });
    expect(await liveCoverId(db, T0)).toBe(promo.coverId);
  });

  it("among overlapping promotions the most recently started one wins", async () => {
    const early = await coverWith({ MOBILE: [1080, 1920] }, "Early");
    await updateWelcomeCover(early.admin, { coverId: early.coverId, startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" }, { db, now: T0 });
    await publishWelcomeCover(early.admin, early.coverId, { db, now: T0 });
    const later = await coverWith({ MOBILE: [1080, 1920] }, "Later");
    await updateWelcomeCover(later.admin, { coverId: later.coverId, startsAt: "2026-09-15T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" }, { db, now: T0 });
    await publishWelcomeCover(later.admin, later.coverId, { db, now: T0 });
    expect(await liveCoverId(db, T0)).toBe(later.coverId);
  });

  it("gives the same answer every time it is asked, and marks only that one LIVE", async () => {
    const a = await coverWith({ MOBILE: [1080, 1920] }, "A");
    await publishWelcomeCover(a.admin, a.coverId, { db, now: T0 });
    const b = await coverWith({ MOBILE: [1080, 1920] }, "B");
    await publishWelcomeCover(b.admin, b.coverId, { db, now: T0 });
    const answers = await Promise.all([liveCoverId(db, T0), liveCoverId(db, T0), liveCoverId(db, T0)]);
    expect(new Set(answers).size).toBe(1);
    const list = await listWelcomeCovers({ db, now: T0 });
    expect(list.covers.filter((c) => c.state === "LIVE")).toHaveLength(1);
    expect(list.covers.filter((c) => c.state === "SUPERSEDED")).toHaveLength(1);
  });
});

describe("restore default", () => {
  it("takes every published cover off air in one action and keeps their artwork", async () => {
    const one = await coverWith({ MOBILE: [1080, 1920] }, "One");
    await publishWelcomeCover(one.admin, one.coverId, { db, now: T0 });
    const two = await coverWith({ DESKTOP: [2560, 1440] }, "Two");
    await publishWelcomeCover(two.admin, two.coverId, { db, now: T0 });

    const after = await restoreDefaultWelcomeCover(one.admin, { db, now: T0 });
    expect(after.showingDefaults).toBe(true);
    expect(await getActiveWelcomeCover(db, T0)).toBe(DEFAULT_COVER);
    expect(after.covers.every((c) => c.state === "ARCHIVED")).toBe(true);
    // Nothing was deleted: both covers still carry the image they published.
    expect(after.covers.find((c) => c.name === "One")!.assets.MOBILE).not.toBeNull();
    expect(await db.welcomeCoverAsset.count()).toBe(2);
  });
});

describe("history and republish", () => {
  it("keeps an archived cover in the list and puts it back on air unchanged", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920] }, "Ramadan");
    await publishWelcomeCover(a, coverId, { db, now: T0 });
    const assetId = (await listWelcomeCovers({ db, now: T0 })).covers[0]!.assets.MOBILE!.id;
    await archiveWelcomeCover(a, coverId, { db, now: T0 });
    expect(await liveCoverId(db, T0)).toBeNull();

    const back = await publishWelcomeCover(a, coverId, { db, now: T0 });
    expect(back.state).toBe("LIVE");
    expect(back.assets.MOBILE!.id).toBe(assetId);
  });

  it("clears a stale end date on republish, so it does not go live and expire in the same instant", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920] });
    await updateWelcomeCover(a, { coverId, endsAt: "2026-09-19T00:00:00Z" }, { db, now: T0 });
    await publishWelcomeCover(a, coverId, { db, now: T0 });
    const republished = await publishWelcomeCover(a, coverId, { db, now: T0 });
    expect(republished.endsAt).toBeNull();
    expect(await liveCoverId(db, T0)).toBe(coverId);
  });
});

describe("removing artwork", () => {
  it("unlinks the variant and deletes the object when nothing else points at it", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920], DESKTOP: [2560, 1440] });
    const assetId = (await listWelcomeCovers({ db, now: T0 })).covers[0]!.assets.MOBILE!.id;
    const key = (await db.welcomeCoverAsset.findUniqueOrThrow({ where: { id: assetId } })).storageKey;
    const after = await removeCoverAsset(a, { coverId, variant: "MOBILE" }, deps);
    expect(after.assets.MOBILE).toBeNull();
    expect(after.assets.DESKTOP).not.toBeNull();
    expect(await storage.read(key)).toBeNull();
  });

  it("is a no-op on an empty slot rather than an error", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920] });
    const after = await removeCoverAsset(a, { coverId, variant: "TABLET" }, deps);
    expect(after.assets.TABLET).toBeNull();
    expect(after.assets.MOBILE).not.toBeNull();
  });

  it("refuses a cover that no longer exists", async () => {
    const a = await admin();
    await expect(removeCoverAsset(a, { coverId: "nope", variant: "MOBILE" }, deps)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the screen survives its dependencies", () => {
  it("falls back to the built-in cover when the database throws", async () => {
    const broken = { welcomeCover: { findFirst: async () => { throw new Error("database is gone"); } } } as never;
    expect(await getActiveWelcomeCover(broken, T0)).toBe(DEFAULT_COVER);
  });

  it("falls back per device when a published cover is missing a variant", async () => {
    const { admin: a, coverId } = await coverWith({ MOBILE: [1080, 1920], TABLET: [1536, 2048] });
    await publishWelcomeCover(a, coverId, { db, now: T0 });
    const view = await getActiveWelcomeCover(db, T0);
    const desktop = view.images.find((i) => i.variant === "DESKTOP")!;
    const mobile = view.images.find((i) => i.variant === "MOBILE")!;
    expect(desktop.custom).toBe(false);
    expect(desktop.src).toBe(DEFAULT_COVER_SOURCES.DESKTOP.src);
    // The promotion's phone artwork must NOT be what a desktop visitor gets.
    expect(desktop.src).not.toBe(mobile.src);
  });

  it("serves the built-in files from the build, needing no database or storage at all", () => {
    for (const source of Object.values(DEFAULT_COVER_SOURCES)) {
      expect(source.src.startsWith("/hero/default-")).toBe(true);
      expect(source.avifSrcSet).not.toBeNull();
    }
  });
});

describe("state reporting", () => {
  it("describes a published-but-not-chosen cover honestly", async () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(describeCoverState({ status: "PUBLISHED", startsAt: null, endsAt: null, id: "x" }, "y", now)).toBe("SUPERSEDED");
  });
});

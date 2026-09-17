import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { deletePhoto, listPhotos, PHOTO_RULES, processAndStorePhoto, reorderPhotos } from "@/server/photos/photos";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { createUser } from "../helpers/factory";

const db = testDb();
let dir: string;
let storage: LocalDiskStorageProvider;

async function jpeg(width = 800, height = 1000, hue = 190): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: hue, g: 200, b: 190 } } }).jpeg().toBuffer());
}
const upload = (actor: { userId: string }, bytes: Uint8Array, type = "image/jpeg") =>
  processAndStorePhoto(actor, { bytes, declaredType: type, size: bytes.byteLength }, { db, storage });

/** A user with no photos yet (the factory adds one by default). */
async function bareUser() {
  const u = await createUser(db, { status: "ONBOARDING" });
  await db.profilePhoto.deleteMany({ where: { profile: { userId: u.userId } } });
  return u;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "thundi-photos-"));
  storage = new LocalDiskStorageProvider(dir, "test-signing-secret-0123456789abcdef0123456789");
});
beforeEach(() => resetDb(db));
afterAll(async () => {
  await disconnectDb();
  await rm(dir, { recursive: true, force: true });
});

describe("profile photos", () => {
  it("processes a valid upload: re-encoded WebP variants, blurhash, user-scoped keys, pending moderation", async () => {
    const me = await bareUser();
    const photo = await upload(me, await jpeg(1600, 2000));
    expect(photo.moderation).toBe("PENDING");
    expect(photo.isPrimary).toBe(true);
    expect(photo.width).toBeLessThanOrEqual(PHOTO_RULES.fullMaxWidth);
    expect(photo.blurhash.length).toBeGreaterThan(6);
    expect(photo.url).toMatch(/^\/api\/media\/profile-photos\/.+\/full\.webp\?exp=\d+&sig=/);
    const row = await db.profilePhoto.findUniqueOrThrow({ where: { id: photo.id } });
    expect(row.storageKey.startsWith(`profile-photos/${me.userId}/`)).toBe(true);
    const full = await storage.read(row.storageKey);
    const thumb = await storage.read(row.thumbKey);
    expect(full && (await sharp(full).metadata()).format).toBe("webp");
    expect(thumb && (await sharp(thumb).metadata()).width).toBe(PHOTO_RULES.thumbWidth);
    // EXIF is dropped by re-encoding
    expect((await sharp(full!).metadata()).exif).toBeUndefined();
    expect((await stat(path.join(dir, row.storageKey))).size).toBeGreaterThan(0);
  });

  it("rejects non-images regardless of the declared MIME type, oversize files and tiny images", async () => {
    const me = await bareUser();
    await expect(upload(me, new TextEncoder().encode("<html>not an image</html>"), "image/jpeg")).rejects.toBeInstanceOf(ValidationError);
    await expect(upload(me, new Uint8Array(0))).rejects.toBeInstanceOf(ValidationError);
    await expect(upload(me, await jpeg(200, 200))).rejects.toThrow(/too small/);
    const big = new Uint8Array(PHOTO_RULES.maxBytes + 1);
    await expect(processAndStorePhoto(me, { bytes: big, declaredType: "image/jpeg", size: big.byteLength }, { db, storage })).rejects.toThrow(/too large/);
    const gif = new Uint8Array(await sharp({ create: { width: 500, height: 500, channels: 3, background: "#fff" } }).gif().toBuffer());
    await expect(upload(me, gif, "image/gif")).rejects.toBeInstanceOf(ValidationError);
    expect(await db.profilePhoto.count()).toBe(0);
  });

  it("enforces the maximum of six, including under concurrent uploads", async () => {
    const me = await bareUser();
    const bytes = await jpeg();
    for (let i = 0; i < PHOTO_RULES.max; i++) await upload(me, bytes);
    await expect(upload(me, bytes)).rejects.toThrow(/up to 6/);
    const other = await bareUser();
    for (let i = 0; i < 4; i++) await upload(other, bytes);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => upload(other, bytes)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await db.profilePhoto.count({ where: { profile: { userId: other.userId } } })).toBe(PHOTO_RULES.max);
  });

  it("refuses to delete or reorder another user's photos", async () => {
    const me = await bareUser();
    const other = await createUser(db);
    const mine = await upload(me, await jpeg());
    const theirs = await db.profilePhoto.findFirstOrThrow({ where: { profile: { userId: other.userId } } });
    await expect(deletePhoto(me, theirs.id, { db, storage })).rejects.toBeInstanceOf(NotFoundError);
    await expect(reorderPhotos(me, [theirs.id], { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(reorderPhotos(me, [mine.id, theirs.id], { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(reorderPhotos(me, [mine.id, mine.id], { db })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.profilePhoto.count({ where: { id: theirs.id } })).toBe(1);
  });

  it("keeps positions contiguous and the primary correct through reorder, delete and rejection", async () => {
    const me = await bareUser();
    const a = await upload(me, await jpeg(800, 1000, 100));
    const b = await upload(me, await jpeg(800, 1000, 150));
    const c = await upload(me, await jpeg(800, 1000, 200));
    let list = await listPhotos(me, { db, storage });
    expect(list.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(list[0]!.isPrimary).toBe(true);

    await reorderPhotos(me, [c.id, a.id, b.id], { db });
    list = await listPhotos(me, { db, storage });
    expect(list.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    expect(list.find((p) => p.isPrimary)?.id).toBe(c.id);

    await deletePhoto(me, c.id, { db, storage });
    list = await listPhotos(me, { db, storage });
    expect(list.map((p) => [p.id, p.position])).toEqual([[a.id, 0], [b.id, 1]]);
    expect(list[0]!.isPrimary).toBe(true);
    const cRow = await db.profilePhoto.findUnique({ where: { id: c.id } });
    expect(cRow).toBeNull();

    // A rejected first photo never becomes the primary discovery photo.
    await db.profilePhoto.update({ where: { id: a.id }, data: { moderation: "REJECTED" } });
    list = await listPhotos(me, { db, storage });
    expect(list.find((p) => p.isPrimary)?.id).toBe(b.id);
  });

  it("signed read URLs expire and cannot be forged", async () => {
    const url = await storage.getReadUrl("profile-photos/u/p/full.webp", 60);
    const u = new URL(url, "http://localhost");
    const exp = Number(u.searchParams.get("exp"));
    const sig = u.searchParams.get("sig")!;
    expect(storage.verify("profile-photos/u/p/full.webp", exp, sig)).toBe(true);
    expect(storage.verify("profile-photos/u/OTHER/full.webp", exp, sig)).toBe(false);
    expect(storage.verify("profile-photos/u/p/full.webp", exp + 1, sig)).toBe(false);
    expect(storage.verify("profile-photos/u/p/full.webp", exp, sig, (exp + 1) * 1000)).toBe(false);
  });
});

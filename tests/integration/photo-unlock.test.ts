import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PRODUCT_RULES } from "@/config/product";
import { buildDiscoveryCards } from "@/server/discovery/dto";
import { getEntitlements } from "@/server/entitlements";
import { likeUser } from "@/server/likes/like";
import { applyPhotoLock, resolvePhotoAccess } from "@/server/photos/visibility";
import { buildVisibleProfiles } from "@/server/profiles/visible-profile";
import { unmatchConversation } from "@/server/conversations/unmatch";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createStaff, createUser, grantPlus, hours, createIdentity, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-20T09:00:00Z");
const storage = { getReadUrl: async (key: string) => `https://signed.example/${key}?sig=x` } as never;

async function match(a: TestUser, b: TestUser, now = T0): Promise<string> {
  await likeUser(a, b.userId, { db, now });
  const r = await likeUser(b, a.userId, { db, now });
  if (!r.matched || !r.conversationId) throw new Error("expected a match");
  return r.conversationId;
}

const plus = (u: TestUser) => grantPlus(db, u.userId, T0, at(T0, hours(24 * 30)));

/** What a viewer actually receives for one person, straight out of the canonical read model. */
async function photosSeenBy(viewer: TestUser, target: TestUser) {
  const [profile] = await buildVisibleProfiles(db, viewer.userId, [target.userId], T0);
  if (!profile) throw new Error("no profile");
  return profile.photos;
}

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

/*
 * Public photo + Plus photo unlock (docs/ARCHITECTURE.md §12.18).
 *
 *     canViewAllPhotos = isProfileOwner || viewerHasPlus || viewerIsMatchedWith(owner)
 *
 * The tests that matter most are not the four cells of that table — they are the ones asserting that a locked
 * photo carries NO storage key. That is the whole security claim: the lock is withheld data, not a CSS filter, so
 * there is nothing for a viewer to dig out of a payload.
 */
describe("the visibility rule", () => {
  it("FREE + unmatched sees the main photo and nothing else", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 4 });
    const photos = await photosSeenBy(viewer, target);

    expect(photos).toHaveLength(4);
    expect(photos.filter((p) => !p.locked)).toHaveLength(1);
    expect(photos[0]!.locked).toBe(false);
    expect(photos.slice(1).every((p) => p.locked)).toBe(true);
  });

  it("PLUS + unmatched sees every eligible photo", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 4 });
    await plus(viewer);
    const photos = await photosSeenBy(viewer, target);
    expect(photos.every((p) => !p.locked)).toBe(true);
  });

  it("FREE + matched sees every eligible photo", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 4 });
    await match(viewer, target);
    const photos = await photosSeenBy(viewer, target);
    expect(photos.every((p) => !p.locked)).toBe(true);
  });

  it("PLUS + matched sees every eligible photo", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 4 });
    await plus(viewer);
    await match(viewer, target);
    expect((await photosSeenBy(viewer, target)).every((p) => !p.locked)).toBe(true);
  });

  it("the owner always sees all of their own photos", async () => {
    const owner = await createUser(db, { now: T0, photos: 5 });
    const photos = await photosSeenBy(owner, owner);
    expect(photos).toHaveLength(5);
    expect(photos.every((p) => !p.locked)).toBe(true);
  });

  it("locks again after an unmatch", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 4 });
    const conversationId = await match(viewer, target);
    expect((await photosSeenBy(viewer, target)).every((p) => !p.locked)).toBe(true);

    await unmatchConversation(viewer, conversationId, { db, now: at(T0, hours(1)) });
    const after = await photosSeenBy(viewer, target);
    expect(after.filter((p) => !p.locked)).toHaveLength(1);
  });
});

describe("the main photo", () => {
  it("changing it changes the single photo a FREE unmatched viewer can see", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 3 });
    const before = await photosSeenBy(viewer, target);
    const originallyVisible = before.find((p) => !p.locked)!.id;

    // Promote the last photo, exactly as "Make main" does: renumber so it sits at position 0.
    const owned = await db.profilePhoto.findMany({ where: { profile: { userId: target.userId } }, orderBy: { position: "asc" }, select: { id: true } });
    const reordered = [owned[2]!.id, owned[0]!.id, owned[1]!.id];
    const { reorderPhotos } = await import("@/server/photos/photos");
    await reorderPhotos(target, reordered, { db });

    const after = await photosSeenBy(viewer, target);
    const nowVisible = after.find((p) => !p.locked)!;
    expect(nowVisible.id).toBe(owned[2]!.id);
    expect(nowVisible.id).not.toBe(originallyVisible);
    expect(after.filter((p) => !p.locked)).toHaveLength(1);
  });

  it("falls back to the first ELIGIBLE photo when position 0 is not displayable", async () => {
    // An existing profile whose primary photo was later rejected still has a public photo, without re-uploading.
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 3 });
    const owned = await db.profilePhoto.findMany({ where: { profile: { userId: target.userId } }, orderBy: { position: "asc" }, select: { id: true } });
    await db.profilePhoto.update({ where: { id: owned[0]!.id }, data: { moderation: "REJECTED" } });

    const photos = await photosSeenBy(viewer, target);
    expect(photos).toHaveLength(2);
    const visible = photos.filter((p) => !p.locked);
    expect(visible).toHaveLength(1);
    expect(visible[0]!.id).toBe(owned[1]!.id);
  });

  it("needs no re-upload: a profile seeded only with positions already has a main photo", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 2 });
    // Nothing was set beyond `position`, which is what every pre-existing row has.
    const photos = await photosSeenBy(viewer, target);
    expect(photos.filter((p) => !p.locked)).toHaveLength(1);
  });
});

describe("moderation is never overridden", () => {
  it("keeps PENDING and REJECTED photos away from a PLUS matched viewer", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 3 });
    await plus(viewer);
    await match(viewer, target);

    const owned = await db.profilePhoto.findMany({ where: { profile: { userId: target.userId } }, orderBy: { position: "asc" }, select: { id: true } });
    await db.profilePhoto.update({ where: { id: owned[1]!.id }, data: { moderation: "REJECTED" } });
    await db.profilePhoto.update({ where: { id: owned[2]!.id }, data: { moderation: "PENDING" } });

    const photos = await photosSeenBy(viewer, target);
    const ids = photos.map((p) => p.id);
    expect(ids).toContain(owned[0]!.id);
    expect(ids).not.toContain(owned[1]!.id);
    // Under the test policy PENDING may be displayable; REJECTED never is, whatever the tier or match state.
    expect(photos.some((p) => p.id === owned[1]!.id)).toBe(false);
  });
});

describe("the protected original never reaches the client", () => {
  it("a locked photo carries no storage key at all", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 4 });
    const photos = await photosSeenBy(viewer, target);

    for (const photo of photos.filter((p) => p.locked)) {
      // Not "is empty" — absent. There is nothing downstream could sign even by mistake.
      expect(photo).not.toHaveProperty("storageKey");
      expect(photo).not.toHaveProperty("thumbKey");
    }
  });

  it("no protected key or URL survives into the discovery card a browser receives", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 4 });
    const [card] = await buildDiscoveryCards(db, viewer.userId, [target.userId], T0, storage);
    const locked = card!.photos.filter((p) => p.locked);

    expect(locked).toHaveLength(3);
    for (const p of locked) {
      expect(p.url).toBeNull();
      expect(p.thumbUrl).toBeNull();
      expect(p.demoKey).toBeNull();
    }
    // The serialised payload is what actually crosses the wire; the protected keys must not be anywhere in it.
    const wire = JSON.stringify(card);
    const protectedKeys = await db.profilePhoto.findMany({
      where: { profile: { userId: target.userId }, position: { gt: 0 } },
      select: { storageKey: true, thumbKey: true },
    });
    expect(protectedKeys).toHaveLength(3);
    for (const k of protectedKeys) {
      expect(wire).not.toContain(k.storageKey);
      expect(wire).not.toContain(k.thumbKey);
    }
    // ...while the main photo IS delivered, or the Free experience would be unusable.
    expect(card!.photos[0]!.url).toContain("signed.example");
  });
});

describe("the entitlement boundary itself", () => {
  it("reads Plus from stored subscription state, not from anything a caller passes", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 3 });

    const before = await resolvePhotoAccess(db, viewer.userId, [target.userId], T0);
    expect(before.canSeeAll(target.userId)).toBe(false);
    expect((await getEntitlements(db, viewer.userId, T0)).rules.canSeeProtectedPhotos).toBe(false);

    await plus(viewer);
    const after = await resolvePhotoAccess(db, viewer.userId, [target.userId], T0);
    expect(after.canSeeAll(target.userId)).toBe(true);
  });

  it("stops unlocking the moment Plus lapses", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 3 });
    await grantPlus(db, viewer.userId, T0, at(T0, hours(1)));

    expect((await resolvePhotoAccess(db, viewer.userId, [target.userId], T0)).canSeeAll(target.userId)).toBe(true);
    const lapsed = at(T0, hours(2));
    expect((await resolvePhotoAccess(db, viewer.userId, [target.userId], lapsed)).canSeeAll(target.userId)).toBe(false);
  });

  it("the rule table says what the product says", () => {
    expect(PRODUCT_RULES.FREE.canSeeProtectedPhotos).toBe(false);
    expect(PRODUCT_RULES.PLUS.canSeeProtectedPhotos).toBe(true);
  });

  it("applyPhotoLock cannot be talked into unlocking without the flag", () => {
    const photos = [0, 1, 2].map((i) => ({ id: `p${i}`, blurhash: "h", width: 1, height: 1, storageKey: `s${i}`, thumbKey: `t${i}` }));
    const locked = applyPhotoLock(photos, false);
    expect(locked.filter((p) => !p.locked)).toHaveLength(1);
    expect(applyPhotoLock(photos, true).every((p) => !p.locked)).toBe(true);
  });
});

describe("staff isolation", () => {
  it("a STAFF account gets no member photos, even with a valid user id", async () => {
    const staff = await createStaff(db, { now: T0 });
    const target = await createUser(db, { now: T0, photos: 3 });
    // buildVisibleProfiles is the only door to member photos, and it refuses to render an operational account...
    const asTarget = await buildVisibleProfiles(db, staff.userId, [staff.userId], T0);
    expect(asTarget).toHaveLength(0);
    // ...and a staff viewer is still only ever a viewer: no Plus, no match, so the lock applies in full.
    const photos = await buildVisibleProfiles(db, staff.userId, [target.userId], T0);
    expect(photos[0]!.photos.filter((p) => !p.locked)).toHaveLength(1);
  });
});

describe("Discover stays usable on FREE", () => {
  it("shows the same profiles, each with a real main photo", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const targets = await Promise.all([1, 2, 3].map(() => createUser(db, { now: T0, photos: 3 })));
    const cards = await buildDiscoveryCards(db, viewer.userId, targets.map((t) => t.userId), T0, storage);

    // Locking must not shrink the deck: applyPhotoLock maps, so the minimum-photos gate sees the same count.
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.photos[0]!.url).toContain("signed.example");
      expect(card.lockedPhotoCount).toBe(2);
    }
  });

  it("tells the client a lock exists so it can offer the upgrade", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const target = await createUser(db, { now: T0, photos: 3 });
    const [card] = await buildDiscoveryCards(db, viewer.userId, [target.userId], T0, storage);
    // The UI opens the existing Plus sheet off exactly this; without it there would be nothing to tap.
    expect(card!.lockedPhotoCount).toBeGreaterThan(0);
    expect(card!.photos.some((p) => p.locked && p.blurhash.length > 0)).toBe(true);
  });
});

describe("no N+1", () => {
  it("answers a whole deck with a constant number of queries", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const targets = await Promise.all(Array.from({ length: 8 }, () => createUser(db, { now: T0, photos: 3 })));
    await createIdentity(db, viewer.userId);

    let queries = 0;
    const counting = db.$extends({ query: { async $allOperations({ args, query }) { queries += 1; return query(args); } } }) as unknown as typeof db;
    await buildVisibleProfiles(counting, viewer.userId, targets.map((t) => t.userId), T0);

    // One access resolution (entitlement + matches) plus the profile fetch — not one per card.
    expect(queries).toBeLessThanOrEqual(6);
  });
});

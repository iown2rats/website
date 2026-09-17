import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOOST, PASS_TTL_MS } from "@/config/product";
import { resetEnvCache } from "@/lib/env";
import { displayablePhotoStates } from "@/lib/photo-policy";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { activateBoost } from "@/server/boosts/boost";
import { buildDiscoveryCards, DISCOVERY_CARD_KEYS } from "@/server/discovery/dto";
import { countRelaxedCandidates, getDeckCandidateIds } from "@/server/discovery/query";
import { likeUser, passUser } from "@/server/likes/like";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createLocation, createUser, grantPlus, hours } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));

beforeEach(() => resetDb(db));
afterEach(() => {
  delete process.env.PHOTO_VISIBILITY_POLICY;
  resetEnvCache();
});
afterAll(() => disconnectDb());

describe("discovery eligibility", () => {
  it("excludes self, incomplete, suspended, deleted, hidden, paused and under-photographed accounts", async () => {
    const viewer = await createUser(db, { now: T0 });
    const ok = await createUser(db, { now: T0 });
    const onboarding = await createUser(db, { now: T0, status: "ONBOARDING" });
    const suspended = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: suspended.userId }, data: { status: "SUSPENDED" } });
    const banned = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: banned.userId }, data: { status: "BANNED" } });
    const deleted = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: deleted.userId }, data: { status: "DELETED", deletedAt: T0 } });
    const hidden = await createUser(db, { now: T0, visibility: "HIDDEN" });
    const paused = await createUser(db, { now: T0 });
    await db.privacySettings.update({ where: { userId: paused.userId }, data: { pausedAt: T0 } });
    const onePhoto = await createUser(db, { now: T0, photos: 1 });
    const rejectedPhotos = await createUser(db, { now: T0, photos: 3, photoModeration: "REJECTED" });
    const pendingPhotos = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });

    const deck = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(deck).toContain(ok.userId);
    expect(deck).toContain(pendingPhotos.userId); // development/test policy: PENDING is displayable (no moderation pipeline yet)
    for (const u of [viewer, onboarding, suspended, banned, deleted, hidden, paused, onePhoto, rejectedPhotos]) expect(deck).not.toContain(u.userId);

    // Production policy (approved-only) hides people whose photos are still pending, everywhere at once.
    process.env.PHOTO_VISIBILITY_POLICY = "approved-only";
    resetEnvCache();
    expect(displayablePhotoStates()).toEqual(["APPROVED"]);
    const strict = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(strict).toContain(ok.userId);
    expect(strict).not.toContain(pendingPhotos.userId);
    const mixed = await createUser(db, { now: T0, photos: 3 });
    const mixedProfile = await db.profile.findUniqueOrThrow({ where: { userId: mixed.userId } });
    await db.profilePhoto.update({ where: { profileId_position: { profileId: mixedProfile.id, position: 2 } }, data: { moderation: "PENDING" } });
    const [card] = await buildDiscoveryCards(db, viewer.userId, [mixed.userId], T0, storage);
    expect(card!.photos).toHaveLength(2); // the pending third photo is not served
  });

  it("excludes blocks in both directions, existing matches, active likes and recent passes; resurfaces old passes", async () => {
    const viewer = await createUser(db, { now: T0 });
    const iBlocked = await createUser(db, { now: T0 });
    const blockedMe = await createUser(db, { now: T0 });
    const matched = await createUser(db, { now: T0 });
    const liked = await createUser(db, { now: T0 });
    const passed = await createUser(db, { now: T0 });
    const oldPass = await createUser(db, { now: T0 });
    const fresh = await createUser(db, { now: T0 });

    await blockUser(viewer, iBlocked.userId, { db, now: T0 });
    await blockUser(blockedMe, viewer.userId, { db, now: T0 });
    await likeUser(viewer, matched.userId, { db, now: T0 });
    await likeUser(matched, viewer.userId, { db, now: T0 });
    await likeUser(viewer, liked.userId, { db, now: T0 });
    await passUser(viewer, passed.userId, { db, now: T0 });
    await passUser(viewer, oldPass.userId, { db, now: at(T0, -PASS_TTL_MS - 1000) });

    const deck = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(deck).toContain(fresh.userId);
    expect(deck).toContain(oldPass.userId);
    for (const u of [iBlocked, blockedMe, matched, liked, passed]) expect(deck).not.toContain(u.userId);
    // Just before the pass expires it is still hidden.
    expect(await getDeckCandidateIds(db, viewer, { now: at(T0, PASS_TTL_MS - 1000) })).not.toContain(passed.userId);
    expect(await getDeckCandidateIds(db, viewer, { now: at(T0, PASS_TTL_MS + 1000) })).toContain(passed.userId);
  });

  it("enforces mutual gender preference without assuming heterosexual matching", async () => {
    const womanWantsWomen = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "WOMEN" });
    const womanWantsWomen2 = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "WOMEN" });
    const womanWantsMen = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN" });
    const manWantsEveryone = await createUser(db, { now: T0, gender: "MAN", interestedIn: "EVERYONE" });
    const manWantsWomen = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN" });
    const unspecifiedEveryone = await createUser(db, { now: T0, gender: "UNSPECIFIED", interestedIn: "EVERYONE" });

    const deck = await getDeckCandidateIds(db, womanWantsWomen, { now: T0 });
    expect(deck).toEqual([womanWantsWomen2.userId]); // womanWantsMen is a woman but does not want women back
    // The man who wants women sees both women who want men... only womanWantsMen wants men.
    const manDeck = await getDeckCandidateIds(db, manWantsWomen, { now: T0 });
    expect(manDeck).toEqual([womanWantsMen.userId]);
    // Everyone ↔ Everyone includes "prefer not to say" in both directions.
    expect(await getDeckCandidateIds(db, manWantsEveryone, { now: T0 })).toContain(unspecifiedEveryone.userId);
    expect(await getDeckCandidateIds(db, unspecifiedEveryone, { now: T0 })).toContain(manWantsEveryone.userId);
    expect(await getDeckCandidateIds(db, unspecifiedEveryone, { now: T0 })).not.toContain(manWantsWomen.userId);
  });

  it("applies the viewer's age range and the candidate's age range (mutual)", async () => {
    const viewer = await createUser(db, { now: T0, age: 30, ageMin: 25, ageMax: 35 });
    const inRange = await createUser(db, { now: T0, age: 28, ageMin: 18, ageMax: 99 });
    const tooYoung = await createUser(db, { now: T0, age: 22 });
    const tooOld = await createUser(db, { now: T0, age: 40 });
    const doesNotWantMyAge = await createUser(db, { now: T0, age: 30, ageMin: 18, ageMax: 25 });
    const deck = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(deck).toEqual([inRange.userId]);
    expect(deck).not.toContain(tooYoung.userId);
    expect(deck).not.toContain(tooOld.userId);
    expect(deck).not.toContain(doesNotWantMyAge.userId);
  });

  it("filters by location scope without any distance or coordinates", async () => {
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const hulhumale = await createLocation(db, { name: "Hulhumalé", atollCode: "K", isGreaterMale: true });
    const maafushi = await createLocation(db, { name: "Maafushi", atollCode: "K" });
    const addu = await createLocation(db, { name: "Addu City", atollCode: "S" });
    const viewer = await createUser(db, { now: T0, locationId: male.id });
    const inHulhumale = await createUser(db, { now: T0, locationId: hulhumale.id });
    const inMaafushi = await createUser(db, { now: T0, locationId: maafushi.id });
    const inAddu = await createUser(db, { now: T0, locationId: addu.id });
    const nowhere = await createUser(db, { now: T0, locationId: null });

    const all = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(all.sort()).toEqual([inHulhumale.userId, inMaafushi.userId, inAddu.userId, nowhere.userId].sort());
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { locationScope: "GREATER_MALE" } });
    expect(await getDeckCandidateIds(db, viewer, { now: T0 })).toEqual([inHulhumale.userId]);
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { locationScope: "MY_ATOLL" } });
    expect((await getDeckCandidateIds(db, viewer, { now: T0 })).sort()).toEqual([inHulhumale.userId, inMaafushi.userId].sort());
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { locationScope: "SPECIFIC", locationId: addu.id } });
    expect(await getDeckCandidateIds(db, viewer, { now: T0 })).toEqual([inAddu.userId]);
  });

  it("tells an over-restrictive filter apart from an exhausted pool", async () => {
    const viewer = await createUser(db, { now: T0, age: 30, ageMin: 50, ageMax: 60 });
    await createUser(db, { now: T0, age: 30 });
    expect(await getDeckCandidateIds(db, viewer, { now: T0 })).toEqual([]);
    expect(await countRelaxedCandidates(db, viewer, T0)).toBe(1);
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { ageMin: 18, ageMax: 99 } });
    const [only] = await getDeckCandidateIds(db, viewer, { now: T0 });
    await passUser(viewer, only!, { db, now: T0 });
    expect(await getDeckCandidateIds(db, viewer, { now: T0 })).toEqual([]);
    expect(await countRelaxedCandidates(db, viewer, T0)).toBe(0);
  });
});

describe("discovery pagination and ranking", () => {
  it("returns bounded batches that never overlap when the client passes what it holds", async () => {
    const viewer = await createUser(db, { now: T0 });
    for (let i = 0; i < 30; i++) await createUser(db, { now: T0 });
    const first = await getDeckCandidateIds(db, viewer, { now: T0, limit: 12 });
    expect(first).toHaveLength(12);
    const second = await getDeckCandidateIds(db, viewer, { now: T0, limit: 12, excludeIds: first });
    expect(second).toHaveLength(12);
    expect(first.filter((id) => second.includes(id))).toEqual([]);
    const third = await getDeckCandidateIds(db, viewer, { now: T0, limit: 12, excludeIds: [...first, ...second] });
    expect(third).toHaveLength(6);
    // Same viewer, same time → same order (deterministic tie-break).
    expect(await getDeckCandidateIds(db, viewer, { now: T0, limit: 12 })).toEqual(first);
    // The limit is clamped.
    expect(await getDeckCandidateIds(db, viewer, { now: T0, limit: 500 })).toHaveLength(30);
  });

  it("ranks active boosts first, then verified, then recently active; expired boosts lose priority", async () => {
    const viewer = await createUser(db, { now: T0 });
    const stale = await createUser(db, { now: T0, lastActiveAt: at(T0, -hours(48)) });
    const recent = await createUser(db, { now: T0, lastActiveAt: at(T0, -hours(1)) });
    const verified = await createUser(db, { now: T0, verified: true, lastActiveAt: at(T0, -hours(72)) });
    const boosted = await createUser(db, { now: T0, lastActiveAt: at(T0, -hours(96)) });
    await grantPlus(db, boosted.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await activateBoost(boosted, { db, now: T0 });

    const during = await getDeckCandidateIds(db, viewer, { now: at(T0, 60_000) });
    expect(during).toEqual([boosted.userId, verified.userId, recent.userId, stale.userId]);
    const after = await getDeckCandidateIds(db, viewer, { now: at(T0, BOOST.durationMs + 1) });
    expect(after).toEqual([verified.userId, recent.userId, stale.userId, boosted.userId]);
  });
});

describe("discovery card DTO", () => {
  it("contains exactly the allow-listed keys and none of the private fields", async () => {
    const viewer = await createUser(db, { now: T0 });
    const c = await createUser(db, { now: T0, name: "Aishath", age: 26 });
    await db.profile.update({ where: { userId: c.userId }, data: { occupation: "Marketing", education: "Villa College", languages: ["Dhivehi"], heightCm: 162 } });
    await grantPlus(db, c.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const [card] = await buildDiscoveryCards(db, viewer.userId, [c.userId], T0, storage);
    expect(card).toBeDefined();
    expect(Object.keys(card!).sort()).toEqual([...DISCOVERY_CARD_KEYS].sort());
    expect(card!.age).toBe(26);
    expect(card!.photos).toHaveLength(2);
    expect(card!.photos[0]!.url).toMatch(/^\/api\/media\/.+\?exp=\d+&sig=/);
    // Signed URLs necessarily embed the user-scoped object path; strip them before auditing the rest of the payload.
    const json = JSON.stringify({ ...card, photos: card!.photos.map((p) => ({ ...p, url: "<url>", thumbUrl: "<url>" })) });
    for (const forbidden of [c.userId, c.phoneE164, "dateOfBirth", "phone", "storageKey", "thumbKey", "test/", "moderation", "invisibleMode", "hideAge", "hideLocation", "subscription", "provider", "tokenHash", "codeHash", "contactHash", "selfie", "userId"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    expect(card!.photos[0]).not.toHaveProperty("storageKey");
    // No birth year appears anywhere (age is derived).
    expect(json).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
  });

  it("omits location and age entirely when the candidate hides them", async () => {
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const viewer = await createUser(db, { now: T0 });
    const shy = await createUser(db, { now: T0, locationId: male.id, hideLocation: true, hideAge: true, age: 31 });
    const open = await createUser(db, { now: T0, locationId: male.id, age: 31 });
    const cards = await buildDiscoveryCards(db, viewer.userId, [shy.userId, open.userId], T0, storage);
    expect(cards[0]).toMatchObject({ location: null, age: null });
    expect(cards[1]).toMatchObject({ location: "Malé", age: 31 });
    expect(JSON.stringify(cards[0])).not.toContain("Malé");
  });

  it("only includes displayable photos, in position order", async () => {
    const viewer = await createUser(db, { now: T0 });
    const c = await createUser(db, { now: T0, photos: 3 });
    const profile = await db.profile.findUniqueOrThrow({ where: { userId: c.userId } });
    await db.profilePhoto.update({ where: { profileId_position: { profileId: profile.id, position: 1 } }, data: { moderation: "REJECTED" } });
    const [card] = await buildDiscoveryCards(db, viewer.userId, [c.userId], T0, storage);
    expect(card!.photos).toHaveLength(2);
    expect(card!.photos.map((p) => p.url)).toEqual(card!.photos.map((p) => p.url).sort((a, b) => (a! < b! ? -1 : 1)));
    expect(displayablePhotoStates()).not.toContain("REJECTED" as never);
  });
});

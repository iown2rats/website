import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PRODUCT_RULES } from "@/config/product";
import { EntitlementRequiredError, LikeLimitReachedError, NotFoundError, UndoUnavailableError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { getDeck, likeByHandle, passByHandle, undoAndRestore } from "@/server/discovery/deck";
import { getDiscoveryFilters, saveDiscoveryFilters } from "@/server/discovery/filters";
import { getDeckCandidateIds } from "@/server/discovery/query";
import { likeUser } from "@/server/likes/like";
import { setInvisibleMode } from "@/server/privacy/invisible-mode";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createLocation, createUser, grantPlus, hours, minutes } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const deps = (now = T0) => ({ db, storage, now });

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("deck page", () => {
  it("returns safe cards, the allowance, server time and capabilities; empty reasons are distinct", async () => {
    const viewer = await createUser(db, { now: T0, age: 30, ageMin: 18, ageMax: 99 });
    const a = await createUser(db, { now: T0 });
    const page = await getDeck(viewer, {}, deps());
    expect(page.cards.map((c) => c.handle)).toEqual([a.handle]);
    expect(page.allowance).toMatchObject({ limit: 30, used: 0, remaining: 30, resetsAt: null, tier: "FREE" });
    expect(page.capabilities).toEqual({ canUndo: false, canUseAdvancedFilters: false, tier: "FREE" });
    expect(page.serverNow).toBe(T0.toISOString());
    expect(page.emptyReason).toBe("NONE");
    expect(page.me.name).toMatch(/^User/);

    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { ageMin: 50, ageMax: 60 } });
    expect((await getDeck(viewer, {}, deps())).emptyReason).toBe("FILTERS");
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { ageMin: 18, ageMax: 99 } });
    await passByHandle(viewer, a.handle, deps());
    expect((await getDeck(viewer, {}, deps())).emptyReason).toBe("EXHAUSTED");
    // Excluding held cards never reports an empty reason (the client already has cards).
    expect((await getDeck(viewer, { excludeHandles: [a.handle] }, deps())).emptyReason).toBe("NONE");
  });

  it("the liker-facing flow: like decrements, pass does not, the 30th succeeds, the 31st is refused with the reset time", async () => {
    const me = await createUser(db, { now: T0 });
    const people = [];
    for (let i = 0; i < 32; i++) people.push(await createUser(db, { now: T0 }));
    await passByHandle(me, people[31]!.handle, deps());
    for (let i = 0; i < 29; i++) await likeByHandle(me, people[i]!.handle, deps());
    const thirtieth = await likeByHandle(me, people[29]!.handle, deps(at(T0, minutes(5))));
    expect(thirtieth.allowance).toMatchObject({ used: 30, remaining: 0, resetsAt: at(T0, hours(24)).toISOString() });
    const err = await likeByHandle(me, people[30]!.handle, deps(at(T0, minutes(6)))).catch((e) => e);
    expect(err).toBeInstanceOf(LikeLimitReachedError);
    expect((err as LikeLimitReachedError).resetsAt.toISOString()).toBe(at(T0, hours(24)).toISOString());
    // Passing still works while likes are exhausted; browsing is never blocked.
    expect((await passByHandle(me, people[30]!.handle, deps(at(T0, minutes(7))))).created).toBe(true);
    // Repeating a like never double-consumes.
    expect((await likeByHandle(me, people[0]!.handle, deps(at(T0, minutes(8))))).allowance.used).toBe(30);
  });

  it("Plus: the 90th like succeeds and the 91st is refused; nobody is told Plus is unlimited", async () => {
    const me = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(48)));
    const people = [];
    for (let i = 0; i < 91; i++) people.push(await createUser(db, { now: T0 }));
    for (let i = 0; i < 89; i++) await likeUser(me, people[i]!.userId, { db, now: T0 });
    const ninetieth = await likeByHandle(me, people[89]!.handle, deps());
    expect(ninetieth.allowance).toMatchObject({ limit: PRODUCT_RULES.PLUS.dailyLikeLimit, remaining: 0, tier: "PLUS" });
    await expect(likeByHandle(me, people[90]!.handle, deps())).rejects.toBeInstanceOf(LikeLimitReachedError);
  });

  it("a mutual like through the deck path returns exactly one match with the other person's safe card", async () => {
    const a = await createUser(db, { now: T0, name: "Aishath" });
    const b = await createUser(db, { now: T0, name: "Hassan" });
    const first = await likeByHandle(a, b.handle, deps());
    expect(first.matched).toBe(false);
    expect(first.match).toBeNull();
    const second = await likeByHandle(b, a.handle, deps(at(T0, 1000)));
    expect(second.matched).toBe(true);
    expect(second.match?.card.name).toBe("Aishath");
    expect(second.match?.conversationId).toBeTruthy();
    expect(JSON.stringify(second)).not.toContain(a.userId);
    expect(await db.match.count()).toBe(1);
    // Simultaneous reciprocal likes through the same path: still one match.
    const c = await createUser(db, { now: T0 });
    const d = await createUser(db, { now: T0 });
    const results = await Promise.all([likeByHandle(c, d.handle, deps()), likeByHandle(d, c.handle, deps())]);
    expect(results.filter((r) => r.matched).length).toBeGreaterThanOrEqual(1);
    expect(await db.match.count({ where: { OR: [{ userAId: c.userId }, { userBId: c.userId }] } })).toBe(1);
  });

  it("unknown handles and blocked people answer NotFound, never revealing existence", async () => {
    const me = await createUser(db, { now: T0 });
    const other = await createUser(db, { now: T0 });
    await blockUser(other, me.userId, { db, now: T0 });
    await expect(likeByHandle(me, "nobody-here", deps())).rejects.toBeInstanceOf(NotFoundError);
    await expect(likeByHandle(me, other.handle, deps())).rejects.toBeInstanceOf(NotFoundError);
    await expect(likeByHandle(me, me.handle, deps())).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("blocking races", () => {
  it("a block concurrent with a mutual like never leaves an ACTIVE match", async () => {
    for (let round = 0; round < 6; round++) {
      const a = await createUser(db, { now: T0 });
      const b = await createUser(db, { now: T0 });
      await likeUser(a, b.userId, { db, now: T0 });
      // B likes A back while A blocks B at the same moment.
      await Promise.allSettled([likeUser(b, a.userId, { db, now: at(T0, 1000) }), blockUser(a, b.userId, { db, now: at(T0, 1000) })]);
      const matches = await db.match.findMany({ where: { OR: [{ userAId: a.userId, userBId: b.userId }, { userAId: b.userId, userBId: a.userId }] } });
      expect(matches.every((m) => m.status === "BLOCKED")).toBe(true);
      expect(await db.like.count({ where: { OR: [{ fromUserId: a.userId, toUserId: b.userId }, { fromUserId: b.userId, toUserId: a.userId }] } })).toBe(0);
      expect(await getDeckCandidateIds(db, b, { now: at(T0, 2000) })).not.toContain(a.userId);
    }
  });

  it("blocking an existing match closes it and locks the conversation", async () => {
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    await likeUser(a, b.userId, { db, now: T0 });
    const r = await likeUser(b, a.userId, { db, now: T0 });
    const result = await blockUser(a, b.userId, { db, now: at(T0, 1000) });
    expect(result.closedMatchId).toBe(r.matchId);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId! } })).status).toBe("LOCKED");
    expect((await blockUser(a, b.userId, { db, now: at(T0, 2000) })).created).toBe(false);
  });
});

describe("undo through the deck", () => {
  it("Free is refused; Plus restores only the most recent eligible pass as a card, without duplicates", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    await passByHandle(me, a.handle, deps());
    await expect(undoAndRestore(me, deps(at(T0, 1000)))).rejects.toBeInstanceOf(EntitlementRequiredError);

    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await passByHandle(me, b.handle, deps(at(T0, 2000)));
    const undone = await undoAndRestore(me, deps(at(T0, 3000)));
    expect(undone.card?.handle).toBe(b.handle);
    const page = await getDeck(me, {}, deps(at(T0, 4000)));
    expect(page.cards.map((c) => c.handle)).toEqual([b.handle]);
    // The older pass (a) is not arbitrarily undoable.
    await expect(undoAndRestore(me, deps(at(T0, 5000)))).rejects.toBeInstanceOf(UndoUnavailableError);
  });

  it("returns no card when the restored person is no longer a valid candidate", async () => {
    const me = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const a = await createUser(db, { now: T0 });
    await passByHandle(me, a.handle, deps());
    await db.privacySettings.update({ where: { userId: a.userId }, data: { pausedAt: at(T0, 500) } });
    const undone = await undoAndRestore(me, deps(at(T0, 1000)));
    expect(undone.card).toBeNull();
    expect((await db.pass.findFirstOrThrow({ where: { fromUserId: me.userId } })).undoneAt).not.toBeNull();
  });
});

describe("filters", () => {
  it("persist to DiscoveryPreferences and a Free user cannot store or benefit from advanced filters", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", age: 30 });
    const tall = await createUser(db, { now: T0, gender: "WOMAN", age: 28 });
    const short = await createUser(db, { now: T0, gender: "WOMAN", age: 28 });
    await db.profile.update({ where: { userId: tall.userId }, data: { heightCm: 180, education: "Villa College" } });
    await db.profile.update({ where: { userId: short.userId }, data: { heightCm: 155, education: "MNU" } });

    const saved = await saveDiscoveryFilters(me, { interestedIn: "WOMEN", ageMin: 22, ageMax: 34, locationScope: "ANYWHERE", intent: null, heightMinCm: 175, education: "Villa" }, { db, now: T0 });
    expect(saved).toMatchObject({ interestedIn: "WOMEN", ageMin: 22, ageMax: 34, heightMinCm: null, education: null, advancedEnabled: false });
    const row = await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: me.userId } });
    expect(row.heightMinCm).toBeNull();
    expect(row.education).toBeNull();
    expect((await getDeckCandidateIds(db, me, { now: T0 })).sort()).toEqual([tall.userId, short.userId].sort());
    // Even a directly written advanced value is ignored without the entitlement.
    await db.discoveryPreferences.update({ where: { userId: me.userId }, data: { heightMinCm: 175 } });
    expect((await getDeckCandidateIds(db, me, { now: T0 })).sort()).toEqual([tall.userId, short.userId].sort());

    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const plus = await saveDiscoveryFilters(me, { interestedIn: "WOMEN", ageMin: 22, ageMax: 34, locationScope: "ANYWHERE", heightMinCm: 175, education: "Villa" }, { db, now: T0 });
    expect(plus).toMatchObject({ heightMinCm: 175, education: "Villa", advancedEnabled: true });
    expect(await getDeckCandidateIds(db, me, { now: T0 })).toEqual([tall.userId]);
    expect(await getDiscoveryFilters(me, { db, now: T0 })).toMatchObject({ heightMinCm: 175 });
  });

  it("validates ranges, location and markup", async () => {
    const me = await createUser(db, { now: T0 });
    const base = { interestedIn: "EVERYONE", ageMin: 22, ageMax: 34, locationScope: "ANYWHERE" };
    await expect(saveDiscoveryFilters(me, { ...base, ageMin: 40 }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveDiscoveryFilters(me, { ...base, ageMin: 17 }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveDiscoveryFilters(me, { ...base, locationScope: "SPECIFIC" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveDiscoveryFilters(me, { ...base, locationScope: "SPECIFIC", locationId: "nope" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveDiscoveryFilters(me, { ...base, interestedIn: "ROBOTS" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    const addu = await createLocation(db, { name: "Addu City", atollCode: "S" });
    const ok = await saveDiscoveryFilters(me, { ...base, locationScope: "SPECIFIC", locationId: addu.id, intent: "MARRIAGE" }, { db, now: T0 });
    expect(ok).toMatchObject({ locationScope: "SPECIFIC", locationId: addu.id, intent: "MARRIAGE" });
    // Unknown keys (e.g. a smuggled userId) are ignored.
    await saveDiscoveryFilters(me, { ...base, userId: "someone-else" }, { db, now: T0 });
    expect(await db.discoveryPreferences.count()).toBe(1);
  });
});

describe("Invisible Mode through the deck", () => {
  it("hidden from people they have not liked, visible to people they liked, and stays hidden after Plus expires", async () => {
    const ghost = await createUser(db, { now: T0, name: "Ghost" });
    await grantPlus(db, ghost.userId, at(T0, -hours(1)), at(T0, hours(1)));
    await setInvisibleMode(ghost, true, { db, now: T0 });
    const liked = await createUser(db, { now: T0 });
    const stranger = await createUser(db, { now: T0 });
    await likeUser(ghost, liked.userId, { db, now: T0 });

    expect((await getDeck(liked, {}, deps())).cards.map((c) => c.handle)).toContain(ghost.handle);
    expect((await getDeck(stranger, {}, deps())).cards.map((c) => c.handle)).not.toContain(ghost.handle);
    // Liked person matches back; the match stays after expiry.
    const r = await likeByHandle(liked, ghost.handle, deps(at(T0, 1000)));
    expect(r.matched).toBe(true);

    const afterLapse = at(T0, hours(2));
    expect((await getDeck(stranger, {}, deps(afterLapse))).cards.map((c) => c.handle)).not.toContain(ghost.handle);
    expect((await db.match.findFirstOrThrow({ where: { id: r.match!.matchId } })).status).toBe("ACTIVE");
    // Even someone the ghost likes after the lapse does not see them: no free premium behaviour, no exposure.
    const later = await createUser(db, { now: T0 });
    await db.like.create({ data: { fromUserId: ghost.userId, toUserId: later.userId, createdAt: afterLapse } });
    expect((await getDeck(later, {}, deps(afterLapse))).cards.map((c) => c.handle)).not.toContain(ghost.handle);
    expect(JSON.stringify(await getDeck(stranger, {}, deps(afterLapse)))).not.toContain("Ghost");
  });
});

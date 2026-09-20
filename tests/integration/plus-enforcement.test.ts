/**
 * Phase 10 entitlement enforcement (docs/ARCHITECTURE.md §12): every paid capability is refused on the server for
 * Free and for lapsed Plus, nothing a client sends can change the tier, protected Likes You data never reaches a Free
 * client, and safety never depends on the plan. Payment and OCR regressions live in billing.test.ts / receipt-ocr.test.ts.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EntitlementRequiredError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { activateBoost } from "@/server/boosts/boost";
import { getDeck } from "@/server/discovery/deck";
import { DISCOVERY_CARD_KEYS } from "@/server/discovery/dto";
import { getDiscoveryFilters, saveDiscoveryFilters } from "@/server/discovery/filters";
import { getEntitlements } from "@/server/entitlements";
import { getMembership } from "@/server/entitlements/presentation";
import { likeUser, passUser, undoLastPass } from "@/server/likes/like";
import { getLikesPage } from "@/server/likes/likes-page";
import { getInvisibleModeState, setInvisibleMode } from "@/server/privacy/invisible-mode";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createSubscription, createUser, grantPlus, hours } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-18T08:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage-plus", "p".repeat(32));
const days = (n: number) => n * 24 * 3_600_000;

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("Plus-only capabilities are server-enforced", () => {
  it("1/10/11/12 · a Free user is refused Undo, Boost and Invisible Mode by the domain functions themselves", async () => {
    const free = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN" });
    const target = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN" });
    await passUser(free, target.userId, { db, now: T0 });
    await expect(undoLastPass(free, { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(EntitlementRequiredError);
    await expect(activateBoost(free, { db, now: T0 })).rejects.toBeInstanceOf(EntitlementRequiredError);
    await expect(setInvisibleMode(free, true, { db, now: T0 })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect((await db.privacySettings.findUniqueOrThrow({ where: { userId: free.userId } })).invisibleMode).toBe(false);
    expect((await db.pass.findFirstOrThrow({ where: { fromUserId: free.userId } })).undoneAt).toBeNull();
    expect(await db.boost.count({ where: { userId: free.userId } })).toBe(0);
  });

  it("9 · paid filter parameters sent by a Free client are discarded on save and ignored on read; Plus keeps them", async () => {
    const free = await createUser(db, { now: T0 });
    const input = { connectionIntent: "DATING", interestedIn: "EVERYONE", ageMin: 22, ageMax: 34, locationScope: "ANYWHERE", locationId: null, intent: null, heightMinCm: 170, heightMaxCm: 190, education: "MNU" };
    const saved = await saveDiscoveryFilters(free, input, { db, now: T0 });
    expect(saved).toMatchObject({ advancedEnabled: false, heightMinCm: null, heightMaxCm: null, education: null });
    const row = await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: free.userId } });
    expect([row.heightMinCm, row.heightMaxCm, row.education]).toEqual([null, null, null]);
    // A stored advanced value (e.g. from a past Plus period) is not applied once Plus lapses.
    await db.discoveryPreferences.update({ where: { userId: free.userId }, data: { heightMinCm: 170 } });
    expect((await getDiscoveryFilters(free, { db, now: T0 })).heightMinCm).toBeNull();
    const plus = await createUser(db, { now: T0 });
    await grantPlus(db, plus.userId, T0, at(T0, days(30)));
    expect(await saveDiscoveryFilters(plus, input, { db, now: T0 })).toMatchObject({ advancedEnabled: true, heightMinCm: 170, heightMaxCm: 190, education: "MNU" });
  });

  it("2 · the tier comes only from Subscription / EntitlementOverride rows: nothing on the actor, the payload or the client can raise it", async () => {
    const u = await createUser(db, { now: T0 });
    const forged = { userId: u.userId, tier: "PLUS", plus: true, role: "ADMIN" } as unknown as typeof u;
    expect((await getEntitlements(db, forged.userId, T0)).tier).toBe("FREE");
    await expect(undoLastPass(forged, { db, now: T0 })).rejects.toBeInstanceOf(EntitlementRequiredError);
    const page = await getLikesPage(forged, { db, storage, now: T0 });
    expect(page.tier).toBe("FREE");
    const membership = await getMembership(forged, { db, now: T0 });
    expect(membership.tier).toBe("FREE");
    expect(membership.comparison.length).toBeGreaterThan(5);
  });

  it("3/4 · active Plus receives the paid rules; expired Plus loses them at the boundary while Free features and safety continue", async () => {
    const u = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", invisibleMode: false });
    const other = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN" });
    await createSubscription(db, u.userId, { periodStart: T0, periodEnd: at(T0, days(30)) });
    const active = await getEntitlements(db, u.userId, at(T0, days(10)));
    expect(active.tier).toBe("PLUS");
    expect(active.rules).toMatchObject({ dailyLikeLimit: 90, canSeeIncomingLikes: true, canUseInvisibleMode: true, boostsPerWindow: 2, canUseAdvancedFilters: true, canUndoPass: true, introsPerWeek: null });
    await setInvisibleMode(u, true, { db, now: at(T0, days(10)) });
    await passUser(u, other.userId, { db, now: at(T0, days(10)) });
    expect((await undoLastPass(u, { db, now: at(T0, days(10) + 1000) })).restoredUserId).toBe(other.userId);
    const boost = await activateBoost(u, { db, now: at(T0, days(11)) });
    expect(boost.boostsRemaining).toBe(1);
    // One second after the period ends: Free rules, paid actions refused, the wish to be invisible kept but suspended.
    const later = at(T0, days(30) + 1000);
    const lapsed = await getEntitlements(db, u.userId, later);
    expect(lapsed.tier).toBe("FREE");
    expect(lapsed.rules.dailyLikeLimit).toBe(30);
    await passUser(u, other.userId, { db, now: later });
    await expect(undoLastPass(u, { db, now: at(later, 1000) })).rejects.toBeInstanceOf(EntitlementRequiredError);
    await expect(activateBoost(u, { db, now: at(later, 1000) })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect(await getInvisibleModeState(u, { db, now: later })).toEqual({ enabled: true, effective: false, suspended: true });
    expect((await getLikesPage(u, { db, storage, now: later })).tier).toBe("FREE");
    expect((await getMembership(u, { db, now: later })).tier).toBe("FREE");
    // Free functionality and safety continue: a like and a block still work.
    const third = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN" });
    expect((await likeUser(u, third.userId, { db, now: at(later, 2000) })).created).toBe(true);
    expect((await blockUser(u, other.userId, { db, now: at(later, 3000) })).created).toBe(true);
    // Turning Invisible Mode off is always allowed, even without Plus.
    expect(await setInvisibleMode(u, false, { db, now: at(later, 4000) })).toEqual({ invisibleMode: false });
  });
});

describe("Likes You privacy boundary", () => {
  it("8 · the Free page carries a count and anonymous placeholders only; the Plus page carries the allow-listed card DTO", async () => {
    const viewer = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN" });
    const a = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", name: "Ahmed Secret", verified: true });
    const b = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", name: "Bashir Hidden" });
    await likeUser(a, viewer.userId, { db, now: T0 });
    await likeUser(b, viewer.userId, { db, now: at(T0, 1000) });
    const free = await getLikesPage(viewer, { db, storage, now: at(T0, 2000) });
    expect(free.tier).toBe("FREE");
    expect(free.count).toBe(2);
    expect(free.cards).toBeNull();
    expect(free.placeholders).toHaveLength(2);
    for (const p of free.placeholders!) expect(Object.keys(p).sort()).toEqual(["blurhash", "verified"]);
    const json = JSON.stringify(free);
    for (const leak of ["Ahmed", "Bashir", a.handle, b.handle, a.userId, b.userId, "handle", "url", "storageKey", "thumbKey", "age"]) expect(json).not.toContain(leak);
    await grantPlus(db, viewer.userId, T0, at(T0, hours(24)));
    const plus = await getLikesPage(viewer, { db, storage, now: at(T0, 3000) });
    expect(plus.tier).toBe("PLUS");
    expect(plus.cards).toHaveLength(2);
    for (const card of plus.cards!) expect(Object.keys(card).sort()).toEqual([...DISCOVERY_CARD_KEYS].sort());
    expect(plus.cards!.map((c) => c.name).sort()).toEqual(["Ahmed Secret", "Bashir Hidden"]);
    expect(JSON.stringify(plus)).not.toMatch(/storageKey|thumbKey|phone|dateOfBirth|userId/);
    // Blocking removes the liker from both views.
    await blockUser(viewer, a.userId, { db, now: at(T0, 4000) });
    expect((await getLikesPage(viewer, { db, storage, now: at(T0, 5000) })).count).toBe(1);
  });
});

describe("Discover page state", () => {
  it("carries the boost allowance for the header without exposing anything new about other people", async () => {
    const free = await createUser(db, { now: T0 });
    const page = await getDeck(free, {}, { db, storage, now: T0 });
    expect(page.boost).toEqual({ limit: 0, remaining: 0, activeEndsAt: null, resetsAt: null });
    const plus = await createUser(db, { now: T0 });
    await grantPlus(db, plus.userId, T0, at(T0, days(7)));
    await activateBoost(plus, { db, now: T0 });
    const boosted = await getDeck(plus, {}, { db, storage, now: at(T0, 1000) });
    expect(boosted.boost).toMatchObject({ limit: 2, remaining: 1, activeEndsAt: at(T0, 30 * 60_000).toISOString() });
    expect(boosted.boost.resetsAt).toBe(at(T0, days(7)).toISOString());
  });
});

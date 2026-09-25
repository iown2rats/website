/**
 * Likes You and Sent (docs/ARCHITECTURE.md §12.5): one incoming-like rule the notification and the page share, a
 * Sent list for every tier, counts that always equal the cards, and a Free Likes You that carries nothing about
 * anybody. Every test runs through `getLikesPage` — the exact object the Likes screen receives — so what is asserted
 * is what reaches the browser.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { getDeck } from "@/server/discovery/deck";
import { getDeckCandidateIds } from "@/server/discovery/query";
import { likeUser, passUser } from "@/server/likes/like";
import { getLikesPage, type LikesYouPageDto } from "@/server/likes/likes-page";
import { getNotificationFeed } from "@/server/notifications/feed";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createLocation, createStaff, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-25T12:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const page = (u: TestUser, now = T0) => getLikesPage(u, { db, storage, now });
const sentHandles = (p: LikesYouPageDto) => p.sent.cards.map((c) => c.handle);

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

const man = (o: Parameters<typeof createUser>[1] = {}) => createUser(db, { now: T0, gender: "MAN", ...o });
const woman = (o: Parameters<typeof createUser>[1] = {}) => createUser(db, { now: T0, gender: "WOMAN", ...o });
const plus = (u: TestUser) => grantPlus(db, u.userId, at(T0, -hours(1)), at(T0, hours(48)));

describe("1–3 · an incoming like, by tier", () => {
  it("1 · A likes B → B sees exactly one incoming like", async () => {
    const a = await man();
    const b = await woman();
    await likeUser(a, b.userId, { db, now: T0 });
    const p = await page(b);
    expect(p.count).toBe(1);
    expect(p.tier).toBe("FREE");
  });

  it("2 · Free B gets a locked like: the count and nothing that identifies A, anywhere in the payload", async () => {
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const a = await man({ name: "Ahmed Secretname", age: 29, locationId: male.id, verified: true });
    await db.profile.update({ where: { userId: a.userId }, data: { bio: "Diver and night-fisher", occupation: "Boat captain" } });
    const b = await woman();
    await likeUser(a, b.userId, { db, now: T0 });

    const p = await page(b);
    expect(p).toMatchObject({ tier: "FREE", count: 1, cards: null });
    const json = JSON.stringify({ count: p.count, cards: p.cards });
    const photos = await db.profilePhoto.findMany({ where: { profile: { userId: a.userId } }, select: { blurhash: true, storageKey: true, thumbKey: true } });
    const leaks = ["Ahmed", "Secretname", a.handle, a.userId, "Malé", "Diver", "Boat captain", "29", ...photos.flatMap((ph) => [ph.blurhash, ph.storageKey, ph.thumbKey])];
    // The whole page, not just the Likes You part: Sent and Matches are B's own and hold nothing about A either.
    const whole = JSON.stringify(p);
    for (const leak of leaks) {
      expect(json).not.toContain(leak);
      expect(whole).not.toContain(leak);
    }
  });

  it("3 · Plus B sees A normally, as the Discover card", async () => {
    const a = await man({ name: "Ahmed" });
    const b = await woman();
    await plus(b);
    await likeUser(a, b.userId, { db, now: T0 });
    const p = await page(b);
    if (p.tier !== "PLUS") throw new Error("expected Plus");
    expect(p.count).toBe(1);
    expect(p.cards.map((c) => [c.handle, c.name])).toEqual([[a.handle, "Ahmed"]]);
  });
});

describe("4–5 · Sent, and what a match does to both lists", () => {
  it("4 · A likes B → A sees B under Sent, on Free, as a normal card", async () => {
    const a = await man();
    const b = await woman({ name: "Hind" });
    await likeUser(a, b.userId, { db, now: T0 });
    const p = await page(a);
    expect(p.tier).toBe("FREE");
    expect(p.sent.count).toBe(1);
    expect(p.sent.cards.map((c) => [c.handle, c.name])).toEqual([[b.handle, "Hind"]]);
    expect(p.count).toBe(0);
  });

  it("5 · B likes A back → one match, and neither pending list shows the other any more", async () => {
    const a = await man();
    const b = await woman();
    await plus(b);
    await likeUser(a, b.userId, { db, now: T0 });
    expect(sentHandles(await page(a))).toEqual([b.handle]);
    expect((await page(b)).count).toBe(1);

    const outcome = await likeUser(b, a.userId, { db, now: at(T0, minutes(1)) });
    expect(outcome.matched).toBe(true);

    const [pa, pb] = [await page(a, at(T0, minutes(2))), await page(b, at(T0, minutes(2)))];
    expect(pa.sent).toEqual({ count: 0, cards: [], superLikes: {} });
    expect(pa.count).toBe(0);
    expect(pb.sent).toEqual({ count: 0, cards: [], superLikes: {} });
    expect(pb.count).toBe(0);
    expect(pa.matches.map((m) => m.handle)).toEqual([b.handle]);
    expect(pb.matches.map((m) => m.handle)).toEqual([a.handle]);
    expect(await db.match.count()).toBe(1);
  });

  it("an unmatched pair does not fall back into Sent or Likes You", async () => {
    const a = await man();
    const b = await woman();
    await likeUser(a, b.userId, { db, now: T0 });
    await likeUser(b, a.userId, { db, now: at(T0, minutes(1)) });
    await db.match.updateMany({ data: { status: "UNMATCHED", unmatchedAt: at(T0, minutes(2)), unmatchedById: a.userId } });
    const [pa, pb] = [await page(a, at(T0, minutes(3))), await page(b, at(T0, minutes(3)))];
    expect([pa.count, pa.sent.count, pb.count, pb.sent.count]).toEqual([0, 0, 0, 0]);
  });
});

describe("6 · a pass before the like (the Ahmed/Hind lifecycle)", () => {
  it("A passes B, B later likes A → B is on A's Likes You; B stays out of A's deck; liking back from Likes You matches", async () => {
    const ahmed = await man({ name: "Ahmed" });
    const hind = await woman({ name: "Hind" });
    await passUser(ahmed, hind.userId, { db, now: at(T0, -hours(6)) });
    await likeUser(hind, ahmed.userId, { db, now: at(T0, -hours(1)) });

    // Free: the notification and the page agree.
    const feed = await getNotificationFeed(ahmed, {}, { db, storage, now: T0 });
    expect(feed.items.filter((i) => i.type === "LIKE_RECEIVED").map((i) => i.title)).toEqual(["Someone liked you"]);
    expect((await page(ahmed)).count).toBe(1);

    // Discover is not rewritten: she is not put back into his deck.
    expect(await getDeckCandidateIds(db, ahmed, { now: T0 })).not.toContain(hind.userId);

    // Plus: he sees her, likes her back from Likes You, and it is a match through the ordinary like flow.
    await plus(ahmed);
    const p = await page(ahmed);
    if (p.tier !== "PLUS") throw new Error("expected Plus");
    expect(p.cards.map((c) => c.handle)).toEqual([hind.handle]);
    const outcome = await likeUser(ahmed, hind.userId, { db, now: T0 });
    expect(outcome.matched).toBe(true);
    expect((await page(ahmed, at(T0, minutes(1)))).count).toBe(0);
    expect(await db.match.count()).toBe(1);
  });

  it("a Discover pass AFTER the like does not hide it either (only a Likes You dismissal does)", async () => {
    const a = await man();
    const b = await woman();
    await likeUser(b, a.userId, { db, now: at(T0, -hours(6)) });
    await passUser(a, b.userId, { db, now: at(T0, -hours(1)) });
    expect((await page(a)).count).toBe(1);
    await passUser(a, b.userId, { db, now: T0, dismissIncomingLike: true });
    expect((await page(a, at(T0, minutes(1)))).count).toBe(0);
  });
});

describe("7–8 · safety overrides both lists", () => {
  it("7 · a block in either direction removes the other person from Likes You and from Sent", async () => {
    for (const blockerIsRecipient of [true, false]) {
      await resetDb(db);
      const a = await man();
      const b = await woman();
      await plus(b);
      await likeUser(a, b.userId, { db, now: T0 });
      if (blockerIsRecipient) await blockUser(b, a.userId, { db, now: at(T0, minutes(1)) });
      else await blockUser(a, b.userId, { db, now: at(T0, minutes(1)) });
      const [pa, pb] = [await page(a, at(T0, minutes(2))), await page(b, at(T0, minutes(2)))];
      expect(pb.count).toBe(0);
      expect(pb.cards).toEqual([]);
      expect(pa.sent).toEqual({ count: 0, cards: [], superLikes: {} });
    }
  });

  it("8 · suspended, banned, deleted and deactivated accounts appear in neither list", async () => {
    const me = await man();
    await plus(me);
    const states = [
      { status: "SUSPENDED" as const },
      { status: "BANNED" as const },
      { status: "ACTIVE" as const, deletedAt: T0 },
      { status: "DELETED" as const, deletedAt: T0 },
    ];
    const ok = await woman({ name: "Available" });
    await likeUser(ok, me.userId, { db, now: T0 });
    await likeUser(me, ok.userId, { db, now: T0 }); // → a match, so she is in neither pending list either
    const incoming: TestUser[] = [];
    const outgoing: TestUser[] = [];
    for (const s of states) {
      const liker = await woman();
      const liked = await woman();
      await likeUser(liker, me.userId, { db, now: T0 });
      await likeUser(me, liked.userId, { db, now: T0 });
      await db.user.update({ where: { id: liker.userId }, data: s });
      await db.user.update({ where: { id: liked.userId }, data: s });
      incoming.push(liker);
      outgoing.push(liked);
    }
    const p = await page(me, at(T0, minutes(1)));
    expect(p.count).toBe(0);
    expect(p.sent.count).toBe(0);
    expect(p.sent.cards).toEqual([]);
  });

  it("Invisible Mode without Plus hides a sent-to member, exactly as it hides them in Discover", async () => {
    const me = await man();
    const her = await woman();
    await likeUser(me, her.userId, { db, now: T0 });
    await db.privacySettings.update({ where: { userId: her.userId }, data: { invisibleMode: true } });
    expect((await page(me)).sent.count).toBe(0);
  });

  it("the pool rule applies to Sent as it does to Likes You, and nothing is deleted", async () => {
    const me = await man();
    const her = await woman();
    await likeUser(me, her.userId, { db, now: T0 });
    await db.discoveryPreferences.update({ where: { userId: her.userId }, data: { connectionIntent: "FRIENDSHIP", friendshipInterestedIn: "EVERYONE", interestedIn: "EVERYONE" } });
    expect((await page(me)).sent.count).toBe(0);
    await db.discoveryPreferences.update({ where: { userId: her.userId }, data: { connectionIntent: "DATING", interestedIn: "MEN" } });
    expect(sentHandles(await page(me))).toEqual([her.handle]);
  });

  it("Sent never reveals the other person's 'no': their pass or their Likes You dismissal changes nothing", async () => {
    const me = await man();
    const her = await woman();
    await plus(her);
    await likeUser(me, her.userId, { db, now: T0 });
    await passUser(her, me.userId, { db, now: at(T0, minutes(1)), dismissIncomingLike: true });
    expect((await page(her, at(T0, minutes(2)))).count).toBe(0);
    expect(sentHandles(await page(me, at(T0, minutes(2))))).toEqual([her.handle]);
  });

  it("staff accounts never appear as likers or liked people (they cannot like and are not members)", async () => {
    const me = await man();
    const staff = await createStaff(db, { now: T0 });
    await expect(likeUser({ userId: staff.userId }, me.userId, { db, now: T0 })).rejects.toThrow();
    const p = await page(me);
    expect([p.count, p.sent.count]).toEqual([0, 0]);
  });
});

describe("9–10 · counts equal cards, and nothing duplicates", () => {
  it("9 · with every exclusion in play, each tab's count is exactly the number of cards it renders", async () => {
    const me = await man();
    await plus(me);
    const women = await Promise.all(Array.from({ length: 9 }, (_, i) => woman({ name: `W${i}` })));
    // Incoming: 0–4 like me. 1 is blocked, 2 is liked back (match), 3 is dismissed, 4 was passed in Discover.
    for (const w of women.slice(0, 5)) await likeUser(w, me.userId, { db, now: T0 });
    await blockUser(me, women[1]!.userId, { db, now: at(T0, minutes(1)) });
    await likeUser(me, women[2]!.userId, { db, now: at(T0, minutes(1)) });
    await passUser(me, women[3]!.userId, { db, now: at(T0, minutes(1)), dismissIncomingLike: true });
    await passUser(me, women[4]!.userId, { db, now: at(T0, minutes(1)) });
    // Outgoing: I like 5–8. 6 is suspended, 7 blocks me, 8 is in the other pool.
    for (const w of women.slice(5)) await likeUser(me, w.userId, { db, now: at(T0, minutes(2)) });
    await db.user.update({ where: { id: women[6]!.userId }, data: { status: "SUSPENDED" } });
    await blockUser(women[7]!, me.userId, { db, now: at(T0, minutes(3)) });
    await db.discoveryPreferences.update({ where: { userId: women[8]!.userId }, data: { connectionIntent: "FRIENDSHIP", friendshipInterestedIn: "EVERYONE", interestedIn: "EVERYONE" } });

    const p = await page(me, at(T0, minutes(5)));
    if (p.tier !== "PLUS") throw new Error("expected Plus");
    expect(p.count).toBe(p.cards.length);
    expect(p.cards.map((c) => c.name).sort()).toEqual(["W0", "W4"]);
    expect(p.sent.count).toBe(p.sent.cards.length);
    expect(p.sent.cards.map((c) => c.name)).toEqual(["W5"]);
    expect(p.matches.map((m) => m.name)).toEqual(["W2"]);

    // And on Free the Likes You number is the same number.
    await db.entitlementOverride.deleteMany({ where: { userId: me.userId } });
    const free = await page(me, at(T0, minutes(5)));
    expect(free).toMatchObject({ tier: "FREE", count: 2 });
  });

  it("10 · repeated likes and repeated page loads never duplicate a card, a like or a notification", async () => {
    const a = await man();
    const b = await woman();
    await plus(b);
    for (let i = 0; i < 3; i++) await likeUser(a, b.userId, { db, now: at(T0, minutes(i)) });
    const loads = await Promise.all([page(a), page(a), page(b), page(b)]);
    for (const p of loads.slice(0, 2)) expect(sentHandles(p)).toEqual([b.handle]);
    for (const p of loads.slice(2)) expect(p.cards?.map((c) => c.handle)).toEqual([a.handle]);
    expect(JSON.stringify(loads[0])).toEqual(JSON.stringify(loads[1]));
    expect(await db.like.count()).toBe(1);
    expect(await db.notification.count({ where: { type: "LIKE_RECEIVED" } })).toBe(1);
  });
});

describe("11–12 · matching and notification integrity", () => {
  it("11 · simultaneous cross-likes create exactly one match, one conversation and one match notification each", async () => {
    for (let round = 0; round < 4; round++) {
      await resetDb(db);
      const a = await man();
      const b = await woman();
      const results = await Promise.all([likeUser(a, b.userId, { db, now: T0 }), likeUser(b, a.userId, { db, now: T0 })]);
      expect(results.some((r) => r.matched)).toBe(true);
      expect(await db.match.count()).toBe(1);
      expect(await db.conversation.count()).toBe(1);
      expect(await db.notification.count({ where: { type: "NEW_MATCH", userId: a.userId } })).toBe(1);
      expect(await db.notification.count({ where: { type: "NEW_MATCH", userId: b.userId } })).toBe(1);
      expect(await db.notification.count({ where: { type: "LIKE_RECEIVED" } })).toBeLessThanOrEqual(1);
      const [pa, pb] = [await page(a, at(T0, 1000)), await page(b, at(T0, 1000))];
      expect([pa.count, pa.sent.count, pb.count, pb.sent.count]).toEqual([0, 0, 0, 0]);
    }
  });

  it("12 · one LIKE_RECEIVED per liker, however often they like, pass or are looked at", async () => {
    const a = await man();
    const b = await woman();
    await likeUser(a, b.userId, { db, now: T0 });
    await likeUser(a, b.userId, { db, now: at(T0, minutes(1)) });
    await passUser(b, a.userId, { db, now: at(T0, minutes(2)) });
    await page(b, at(T0, minutes(3)));
    await getNotificationFeed(b, {}, { db, storage, now: at(T0, minutes(3)) });
    await getDeck(b, {}, { db, storage, now: at(T0, minutes(3)) });
    expect(await db.notification.count({ where: { type: "LIKE_RECEIVED", userId: b.userId } })).toBe(1);
  });

  it("the notification and the page agree for every reason a like can be on the page", async () => {
    const me = await man();
    const likers = await Promise.all([woman(), woman(), woman()]);
    await passUser(me, likers[0]!.userId, { db, now: at(T0, -hours(3)) }); // pass before
    for (const l of likers) await likeUser(l, me.userId, { db, now: at(T0, -hours(2)) });
    await passUser(me, likers[1]!.userId, { db, now: at(T0, -hours(1)) }); // Discover pass after
    const feed = await getNotificationFeed(me, {}, { db, storage, now: T0 });
    const likeRows = feed.items.filter((i) => i.type === "LIKE_RECEIVED");
    expect(likeRows).toHaveLength(3);
    expect((await page(me)).count).toBe(3);
  });
});

describe("13 · the Free payload cannot be matched against anything else the member receives", () => {
  it("no photo blurhash from the liker's Discover card appears in the Likes page", async () => {
    const b = await woman();
    const a = await man({ name: "Correlate" });
    // B can see A in Discover: that card carries A's photo blurhashes, the string the old tiles also carried.
    const deck = await getDeck(b, {}, { db, storage, now: T0 });
    const card = deck.cards.find((c) => c.handle === a.handle);
    expect(card).toBeTruthy();
    const hashes = card!.photos.map((ph) => ph.blurhash).filter(Boolean);
    expect(hashes.length).toBeGreaterThan(0);

    await likeUser(a, b.userId, { db, now: at(T0, minutes(1)) });
    const p = await page(b, at(T0, minutes(2)));
    expect(p.count).toBe(1);
    const json = JSON.stringify(p);
    for (const h of hashes) expect(json).not.toContain(h);
    for (const leak of [a.handle, a.userId, "Correlate"]) expect(json).not.toContain(leak);
  });
});

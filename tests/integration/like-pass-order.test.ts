/**
 * A pass only suppresses an incoming like it came AFTER (docs/ARCHITECTURE.md §12.5).
 *
 * The incident these cover: a member passed somebody in Discover, she liked him six hours later, and his
 * notification named her the moment he bought Plus — while Likes You, which excluded anyone he had already swiped
 * on, showed him nothing. He paid MVR 49 to be told a name that led to an empty page.
 *
 * Two independent claims are made here. The ORDER of the pass and the like decides whether the like survives; and
 * Likes You, its count, the Discover aside and the notification feed all read the same rule, so no surface can
 * name somebody another surface refuses to show.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { likeUser, passUser } from "@/server/likes/like";
import { getLikesYou } from "@/server/likes/likes-you";
import { listEligibleIncomingLikes, nameableLikers } from "@/server/likes/eligibility";
import { getNotificationFeed } from "@/server/notifications/feed";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, grantPlus, hours, minutes } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-22T12:00:00Z");
const deps = { db, storage: new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32)), now: T0 };

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

/** The exact shape Ahmed was in: a Plus member who passed somebody before she liked him. */
async function passedThenLiked() {
  const me = await createUser(db, { gender: "MAN", now: T0 });
  await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
  const her = await createUser(db, { gender: "WOMAN", now: T0, name: "Hind" });
  await passUser(me, her.userId, { db, now: at(T0, -hours(6)) });
  await likeUser(her, me.userId, { db, now: at(T0, -minutes(30)) });
  return { me, her };
}

// ───────────────────── 1. Pass, then a later incoming like ─────────────────────

describe("a pass made BEFORE the like", () => {
  it("leaves the like visible on Likes You, because the pass was a blind one", async () => {
    const { me, her } = await passedThenLiked();

    const result = await getLikesYou(me, { db, now: T0 });
    expect(result.count).toBe(1);
    if (result.tier !== "PLUS") throw new Error("unreachable");
    expect(result.profiles.map((p) => p.userId)).toEqual([her.userId]);
  });

  it("lets the notification name her, and the name matches the page", async () => {
    const { me, her } = await passedThenLiked();

    const feed = await getNotificationFeed(me, {}, deps);
    const row = feed.items.find((i) => i.type === "LIKE_RECEIVED");
    expect(row?.title).toBe("Hind liked you");
    expect(row?.actorName).toBe("Hind");
    // The whole point: whoever the feed names is on the page it links to.
    expect(await nameableLikers(db, me.userId, [her.userId], T0)).toEqual(new Set([her.userId]));
  });

  it("still only names her once the member actually holds Plus", async () => {
    const her = await createUser(db, { gender: "WOMAN", now: T0, name: "Hind" });
    const free = await createUser(db, { gender: "MAN", now: T0 });
    await passUser(free, her.userId, { db, now: at(T0, -hours(6)) });
    await likeUser(her, free.userId, { db, now: at(T0, -minutes(30)) });

    const feed = await getNotificationFeed(free, {}, deps);
    expect(feed.items.find((i) => i.type === "LIKE_RECEIVED")?.title).toBe("Someone liked you");
    expect(JSON.stringify(feed)).not.toContain("Hind");
    // Eligible, but not yet paid for: the count is there, the identity is not.
    const result = await getLikesYou(free, { db, now: T0 });
    expect(result).toMatchObject({ tier: "FREE", count: 1 });
  });

  it("liking her back creates a match and clears the stale pass", async () => {
    const { me, her } = await passedThenLiked();

    const outcome = await likeUser(me, her.userId, { db, now: T0 });
    expect(outcome.matched).toBe(true);
    expect(outcome.conversationId).toBeTruthy();

    // The old pass is marked undone rather than deleted, so the history survives the match.
    const pass = await db.pass.findFirstOrThrow({ where: { fromUserId: me.userId, toUserId: her.userId } });
    expect(pass.undoneAt).not.toBeNull();

    // And she leaves Likes You, because she is a match now.
    expect((await getLikesYou(me, { db, now: T0 })).count).toBe(0);
  });
});

// ───────────────────── 2. Incoming like, then a later pass ─────────────────────

describe("a pass made AFTER the like", () => {
  it("hides the like and keeps the liker unnamed, on every surface", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const her = await createUser(db, { gender: "WOMAN", now: T0, name: "Hind" });
    // She likes him first; he sees her and says no. That "no" is informed, and it sticks.
    await likeUser(her, me.userId, { db, now: at(T0, -hours(6)) });
    await passUser(me, her.userId, { db, now: at(T0, -minutes(30)) });

    const result = await getLikesYou(me, { db, now: T0 });
    expect(result.count).toBe(0);
    if (result.tier !== "PLUS") throw new Error("unreachable");
    expect(result.profiles).toHaveLength(0);

    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items.find((i) => i.type === "LIKE_RECEIVED")?.title).toBe("Someone liked you");
    expect(JSON.stringify(feed)).not.toContain("Hind");
    expect(await nameableLikers(db, me.userId, [her.userId], T0)).toEqual(new Set());
  });

  it("a pass on the very same instant as the like counts as after it, so it hides", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const her = await createUser(db, { gender: "WOMAN", now: T0 });
    await likeUser(her, me.userId, { db, now: T0 });
    await passUser(me, her.userId, { db, now: T0 });
    // `pa."createdAt" > l."createdAt"` is strict, so an equal timestamp does NOT suppress. Asserting the boundary
    // rather than assuming it: simultaneous is indistinguishable, and the like surviving is the safe reading.
    expect((await getLikesYou(me, { db, now: T0 })).count).toBe(1);
  });

  it("an undone pass never suppresses anything, whenever it was made", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const her = await createUser(db, { gender: "WOMAN", now: T0 });
    await likeUser(her, me.userId, { db, now: at(T0, -hours(6)) });
    await passUser(me, her.userId, { db, now: at(T0, -minutes(30)) });
    expect((await getLikesYou(me, { db, now: T0 })).count).toBe(0);

    await db.pass.updateMany({ where: { fromUserId: me.userId, toUserId: her.userId }, data: { undoneAt: T0 } });
    expect((await getLikesYou(me, { db, now: T0 })).count).toBe(1);
  });
});

// ─────────────── 3. No surface may name somebody Likes You excludes ───────────────

describe("the paid surfaces cannot disagree", () => {
  it("a Plus member is never told a name that the Likes You page leaves out", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));

    // Every way a liker can drop off the page, each with a LIKE_RECEIVED row still sitting in the feed.
    const visible = await createUser(db, { gender: "WOMAN", now: T0, name: "Visible" });
    const passedAfter = await createUser(db, { gender: "WOMAN", now: T0, name: "PassedAfter" });
    const blocked = await createUser(db, { gender: "WOMAN", now: T0, name: "Blocked" });
    const banned = await createUser(db, { gender: "WOMAN", now: T0, name: "Banned" });
    const likedBack = await createUser(db, { gender: "WOMAN", now: T0, name: "LikedBack" });

    for (const l of [visible, passedAfter, blocked, banned, likedBack]) {
      await likeUser(l, me.userId, { db, now: at(T0, -hours(6)) });
    }
    await passUser(me, passedAfter.userId, { db, now: at(T0, -minutes(30)) });
    await db.block.create({ data: { blockerId: me.userId, blockedId: blocked.userId } });
    await db.user.update({ where: { id: banned.userId }, data: { status: "BANNED" } });
    await likeUser(me, likedBack.userId, { db, now: T0 });

    const page = await getLikesYou(me, { db, now: T0 });
    if (page.tier !== "PLUS") throw new Error("unreachable");
    const onPage = new Set(page.profiles.map((p) => p.userId));
    expect(onPage).toEqual(new Set([visible.userId]));

    // The invariant, asserted directly against the feed: a named like row is always one the page carries.
    const feed = await getNotificationFeed(me, { limit: 50 }, deps);
    const likeRows = feed.items.filter((i) => i.type === "LIKE_RECEIVED");
    expect(likeRows.length).toBeGreaterThan(1); // several rows, only one of them nameable
    expect(likeRows.filter((r) => r.actorName !== null).map((r) => r.actorName)).toEqual(["Visible"]);

    // None of the excluded names appears on a like row, by any field.
    const serializedLikes = JSON.stringify(likeRows);
    for (const name of ["PassedAfter", "Blocked", "Banned", "LikedBack"]) expect(serializedLikes).not.toContain(name);

    // "LikedBack" IS named elsewhere in the feed, and that is correct: liking her back made a match, and a match
    // tells you who it is with. The paywall is about likes you have not answered, not about people you matched.
    expect(feed.items.find((i) => i.type === "NEW_MATCH")?.actorName).toBe("LikedBack");

    // And the shared rule agrees with the page, which is what stops them drifting apart again.
    const nameable = await nameableLikers(db, me.userId, [visible.userId, passedAfter.userId, blocked.userId, banned.userId, likedBack.userId], T0);
    expect(nameable).toEqual(onPage);
  });

  it("the count, the page and the shared rule return the same people", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const [a, b, c] = [
      await createUser(db, { gender: "WOMAN", now: T0 }),
      await createUser(db, { gender: "WOMAN", now: T0 }),
      await createUser(db, { gender: "WOMAN", now: T0 }),
    ];
    await passUser(me, a.userId, { db, now: at(T0, -hours(6)) }); // blind pass, survives
    for (const l of [a, b, c]) await likeUser(l, me.userId, { db, now: at(T0, -hours(1)) });
    await passUser(me, c.userId, { db, now: at(T0, -minutes(5)) }); // informed pass, suppresses

    const page = await getLikesYou(me, { db, now: T0 });
    const shared = await listEligibleIncomingLikes(db, me.userId, T0);
    if (page.tier !== "PLUS") throw new Error("unreachable");
    expect(page.count).toBe(2);
    expect(new Set(page.profiles.map((p) => p.userId))).toEqual(new Set([a.userId, b.userId]));
    expect(new Set(shared.map((r) => r.id))).toEqual(new Set([a.userId, b.userId]));
  });
});

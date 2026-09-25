/**
 * A Discover pass never hides an incoming like; only a "no" said on Likes You does (docs/ARCHITECTURE.md §12.5).
 *
 * Two incidents these cover. First: a member passed somebody in Discover, she liked him six hours later, and his
 * notification named her the moment he bought Plus — while Likes You, which excluded anyone he had already swiped
 * on, showed him nothing. Second, after that was fixed by ordering: a pass made AFTER the like still hid it, and in
 * production 28 of the 29 likes that rule hid belonged to Free members who had been told only "Someone liked you"
 * and then passed that very person in Discover, which never says who liked you. Notification, empty page.
 *
 * Two independent claims are made here. No Discover pass, before or after, hides a like — only `dismissIncomingLike`
 * (a Pass on Likes You) does; and Likes You, its count, the Discover aside and the notification feed all read the
 * same rule, so no surface can name somebody another surface refuses to show.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { likeUser, passUser } from "@/server/likes/like";
import { getLikesYou } from "@/server/likes/likes-you";
import { listEligibleIncomingLikes, nameableLikers } from "@/server/likes/eligibility";
import { getNotificationFeed } from "@/server/notifications/feed";
import { getDeckCandidateIds } from "@/server/discovery/query";
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

describe("a Discover pass made AFTER the like", () => {
  it("leaves the like on Likes You: Discover never said who liked you, so the pass says nothing about the like", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const her = await createUser(db, { gender: "WOMAN", now: T0, name: "Hind" });
    await likeUser(her, me.userId, { db, now: at(T0, -hours(6)) });
    await passUser(me, her.userId, { db, now: at(T0, -minutes(30)) });

    // Free: the notification says "Someone liked you" and the page agrees — one like, locked.
    expect(await getLikesYou(me, { db, now: T0 })).toEqual({ tier: "FREE", count: 1 });
    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items.find((i) => i.type === "LIKE_RECEIVED")?.title).toBe("Someone liked you");

    // Plus: she is on the page, and the feed may name her because she is.
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const plus = await getLikesYou(me, { db, now: T0 });
    if (plus.tier !== "PLUS") throw new Error("unreachable");
    expect(plus.profiles.map((p) => p.userId)).toEqual([her.userId]);
    expect((await getNotificationFeed(me, {}, deps)).items.find((i) => i.type === "LIKE_RECEIVED")?.actorName).toBe("Hind");
  });

  it("still keeps her out of the Discover deck for the pass window — a pass does what a pass does", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const her = await createUser(db, { gender: "WOMAN", now: T0 });
    await likeUser(her, me.userId, { db, now: at(T0, -hours(6)) });
    await passUser(me, her.userId, { db, now: at(T0, -minutes(30)) });
    expect(await getDeckCandidateIds(db, me, { now: T0 })).not.toContain(her.userId);
    expect((await getLikesYou(me, { db, now: T0 })).count).toBe(1);
  });
});

describe("a Pass tapped on Likes You", () => {
  it("dismisses the like: it leaves the page, the count, the aside rule and the feed's name, and nothing is deleted", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const her = await createUser(db, { gender: "WOMAN", now: T0, name: "Hind" });
    await likeUser(her, me.userId, { db, now: at(T0, -hours(6)) });
    await passUser(me, her.userId, { db, now: at(T0, -minutes(30)), dismissIncomingLike: true });

    const result = await getLikesYou(me, { db, now: T0 });
    expect(result.count).toBe(0);
    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items.find((i) => i.type === "LIKE_RECEIVED")?.title).toBe("Someone liked you");
    expect(JSON.stringify(feed)).not.toContain("Hind");
    expect(await nameableLikers(db, me.userId, [her.userId], T0)).toEqual(new Set());

    // Recorded on her like, not by removing it: the like and the notification both still exist.
    const like = await db.like.findUniqueOrThrow({ where: { fromUserId_toUserId: { fromUserId: her.userId, toUserId: me.userId } } });
    expect(like.dismissedAt).toEqual(at(T0, -minutes(30)));
    expect(await db.notification.count({ where: { userId: me.userId, type: "LIKE_RECEIVED" } })).toBe(1);
  });

  it("touches only that one like: not the actor's own likes, not anybody else's", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const her = await createUser(db, { gender: "WOMAN", now: T0 });
    const other = await createUser(db, { gender: "WOMAN", now: T0 });
    const third = await createUser(db, { gender: "MAN", now: T0 });
    await likeUser(her, me.userId, { db, now: at(T0, -hours(2)) });
    await likeUser(other, me.userId, { db, now: at(T0, -hours(2)) });
    await likeUser(her, third.userId, { db, now: at(T0, -hours(2)) });
    await passUser(me, her.userId, { db, now: T0, dismissIncomingLike: true });
    expect(await db.like.count({ where: { dismissedAt: { not: null } } })).toBe(1);
    expect((await getLikesYou(me, { db, now: T0 })).count).toBe(1);
    expect((await getLikesYou(third, { db, now: T0 })).count).toBe(1);
  });

  it("is a no-op on the like when there is none (a plain pass), and never blocks a later like back from making a match", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const her = await createUser(db, { gender: "WOMAN", now: T0 });
    await passUser(me, her.userId, { db, now: at(T0, -hours(3)), dismissIncomingLike: true });
    expect(await db.like.count()).toBe(0);

    await likeUser(her, me.userId, { db, now: at(T0, -hours(2)) });
    await passUser(me, her.userId, { db, now: at(T0, -hours(1)), dismissIncomingLike: true });
    // A dismissal is not a block: if he changes his mind in Discover later, it is still a match.
    expect((await likeUser(me, her.userId, { db, now: T0 })).matched).toBe(true);
  });
});

// ─────────────── 3. No surface may name somebody Likes You excludes ───────────────

describe("the paid surfaces cannot disagree", () => {
  it("a Plus member is never told a name that the Likes You page leaves out", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));

    // Every way a liker can drop off the page, each with a LIKE_RECEIVED row still sitting in the feed.
    const visible = await createUser(db, { gender: "WOMAN", now: T0, name: "Visible" });
    const dismissed = await createUser(db, { gender: "WOMAN", now: T0, name: "Dismissed" });
    const blocked = await createUser(db, { gender: "WOMAN", now: T0, name: "Blocked" });
    const banned = await createUser(db, { gender: "WOMAN", now: T0, name: "Banned" });
    const likedBack = await createUser(db, { gender: "WOMAN", now: T0, name: "LikedBack" });

    for (const l of [visible, dismissed, blocked, banned, likedBack]) {
      await likeUser(l, me.userId, { db, now: at(T0, -hours(6)) });
    }
    await passUser(me, dismissed.userId, { db, now: at(T0, -minutes(30)), dismissIncomingLike: true });
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
    for (const name of ["Dismissed", "Blocked", "Banned", "LikedBack"]) expect(serializedLikes).not.toContain(name);

    // "LikedBack" IS named elsewhere in the feed, and that is correct: liking her back made a match, and a match
    // tells you who it is with. The paywall is about likes you have not answered, not about people you matched.
    expect(feed.items.find((i) => i.type === "NEW_MATCH")?.actorName).toBe("LikedBack");

    // And the shared rule agrees with the page, which is what stops them drifting apart again.
    const nameable = await nameableLikers(db, me.userId, [visible.userId, dismissed.userId, blocked.userId, banned.userId, likedBack.userId], T0);
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
    await passUser(me, c.userId, { db, now: at(T0, -minutes(5)), dismissIncomingLike: true }); // a "no" on Likes You

    const page = await getLikesYou(me, { db, now: T0 });
    const shared = await listEligibleIncomingLikes(db, me.userId, T0);
    if (page.tier !== "PLUS") throw new Error("unreachable");
    expect(page.count).toBe(2);
    expect(new Set(page.profiles.map((p) => p.userId))).toEqual(new Set([a.userId, b.userId]));
    expect(new Set(shared.map((r) => r.id))).toEqual(new Set([a.userId, b.userId]));
  });
});

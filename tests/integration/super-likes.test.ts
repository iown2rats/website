/**
 * Super Likes (docs/ARCHITECTURE.md §12.20): Plus-only, 5 per 7-day window, an optional ≤150-character message that
 * becomes the first chat message on a match — and exactly the same eligibility, safety and privacy rules as a like.
 * Numbered tests are the 40 required scenarios; the unnumbered ones are the listed edge cases.
 *
 * Everything goes through the domain functions the server actions call (`superLikeUser` / `superLikeByHandle`), and
 * the read side through `getLikesPage` — the exact object the Likes screen receives — so what is asserted about
 * privacy is what reaches the browser.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EntitlementRequiredError, InvalidStateError, NotFoundError, SuperLikeLimitReachedError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { sendMessage, listMessages } from "@/server/conversations/messages";
import { getDeck, likeByHandle, superLikeByHandle } from "@/server/discovery/deck";
import { getSuperLikeAllowance } from "@/server/entitlements";
import { getMembership } from "@/server/entitlements/presentation";
import { ALREADY_LIKED, likeUser, passUser, superLikeUser } from "@/server/likes/like";
import { getLikesYou } from "@/server/likes/likes-you";
import { getLikesPage, type LikesYouPageDto } from "@/server/likes/likes-page";
import { getNotificationFeed } from "@/server/notifications/feed";
import { pushCopyFor } from "@/server/notifications/push-copy";
import { setInvisibleMode } from "@/server/privacy/invisible-mode";
import { blockUser } from "@/server/safety/block";
import { authKindForUser } from "@/server/auth/session";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createStaff, createSubscription, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-25T12:00:00Z");
const DAY = hours(24);
const WEEK = 7 * DAY;
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const page = (u: TestUser, now = at(T0, minutes(30))) => getLikesPage(u, { db, storage, now });

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

const man = (o: Parameters<typeof createUser>[1] = {}) => createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ...o });
const woman = (o: Parameters<typeof createUser>[1] = {}) => createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN", ...o });
const plus = (u: TestUser, from = at(T0, -hours(1)), to = at(T0, 60 * DAY)) => grantPlus(db, u.userId, from, to);
const women = async (n: number) => Promise.all(Array.from({ length: n }, (_, i) => woman({ name: `W${i}` })));

/** What the SUPER_LIKES counter says, straight from the table (null: no row, i.e. nothing ever spent). */
async function superUsed(userId: string): Promise<number | null> {
  const row = await db.usageCounter.findUnique({ where: { userId_kind: { userId, kind: "SUPER_LIKES" } }, select: { used: true } });
  return row?.used ?? null;
}
/** Spent this window, whether or not a counter row was ever written. */
const superSpent = async (userId: string) => (await superUsed(userId)) ?? 0;
const likeRow = (from: TestUser, to: TestUser) => db.like.findUnique({ where: { fromUserId_toUserId: { fromUserId: from.userId, toUserId: to.userId } }, include: { intro: true } });
const plusPage = (p: LikesYouPageDto) => {
  if (p.tier !== "PLUS") throw new Error("expected the Plus page");
  return p;
};
const freePage = (p: LikesYouPageDto) => {
  if (p.tier !== "FREE") throw new Error("expected the Free page");
  return p;
};

// ───────────────────────────── Who may send ─────────────────────────────

describe("1–3 · entitlement, on the server", () => {
  it("1 · a Free member cannot send a Super Like — nothing is created and nothing is spent", async () => {
    const a = await man();
    const b = await woman();
    await expect(superLikeUser(a, b.userId, { db, now: T0, message: "hi" })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect(await db.like.count()).toBe(0);
    expect(await db.intro.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
    // Not even a zeroed counter row: the refusal rolled the whole transaction back.
    expect(await superUsed(a.userId)).toBeNull();
  });

  it("2 · a Free member's direct request (the handler the server action runs) is refused the same way", async () => {
    const a = await man();
    const b = await woman();
    await expect(superLikeByHandle(a, b.handle, "crafted request", { db, storage, now: T0 })).rejects.toBeInstanceOf(EntitlementRequiredError);
    // A normal like is still theirs to send, and the refusal did not touch it.
    const liked = await likeUser(a, b.userId, { db, now: at(T0, 1000) });
    expect(liked).toMatchObject({ created: true, kind: "NORMAL" });
    expect(await superUsed(a.userId)).toBeNull();
  });

  it("3 · a Plus member can send a Super Like: one SUPER like, one spent, four left", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    const r = await superLikeUser(a, b.userId, { db, now: T0 });
    expect(r).toMatchObject({ created: true, kind: "SUPER", matched: false, likesRemaining: 4 });
    expect(r.likesResetAt.getTime()).toBe(T0.getTime() + WEEK);
    const row = await likeRow(a, b);
    expect(row).toMatchObject({ kind: "SUPER", introId: null, dismissedAt: null });
    expect(await superUsed(a.userId)).toBe(1);
    expect(await getSuperLikeAllowance(db, a.userId, at(T0, 1))).toMatchObject({ limit: 5, used: 1, remaining: 4, tier: "PLUS" });
  });
});

// ───────────────────────────── The message ─────────────────────────────

describe("4–6 · the optional message", () => {
  it("4 · a valid message (≤150, trimmed) is kept with the Super Like — exactly 150 is accepted", async () => {
    const a = await man();
    const [b, c] = await women(2);
    await plus(a);
    await superLikeUser(a, b!.userId, { db, now: T0, message: "  Your diving photo got my attention 😄  " });
    expect((await likeRow(a, b!))?.intro?.body).toBe("Your diving photo got my attention 😄");
    const exactly150 = "x".repeat(150);
    await superLikeUser(a, c!.userId, { db, now: at(T0, 1000), message: exactly150 });
    expect((await likeRow(a, c!))?.intro?.body).toBe(exactly150);
  });

  it("5 · an empty or whitespace-only message is no message — the Super Like still goes, with no Intro", async () => {
    const a = await man();
    const [b, c] = await women(2);
    await plus(a);
    await superLikeUser(a, b!.userId, { db, now: T0, message: "" });
    await superLikeUser(a, c!.userId, { db, now: at(T0, 1000), message: "   \n\t  " });
    expect((await likeRow(a, b!))).toMatchObject({ kind: "SUPER", introId: null });
    expect((await likeRow(a, c!))).toMatchObject({ kind: "SUPER", introId: null });
    expect(await db.intro.count()).toBe(0);
    expect(await superUsed(a.userId)).toBe(2);
  });

  it("6 · more than 150 characters is refused by the server — and refusing spends nothing", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await expect(superLikeUser(a, b.userId, { db, now: T0, message: "x".repeat(151) })).rejects.toBeInstanceOf(ValidationError);
    await expect(superLikeUser(a, b.userId, { db, now: T0, message: "😄".repeat(151) })).rejects.toBeInstanceOf(ValidationError);
    await expect(superLikeByHandle(a, b.handle, "y".repeat(2000), { db, storage, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.like.count()).toBe(0);
    expect(await superUsed(a.userId)).toBeNull();
  });

  it("emoji and other non-Latin text are counted as people count them: 150 emoji fit, 151 do not", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    const emoji = "😄".repeat(150); // 300 UTF-16 units, 150 characters
    await superLikeUser(a, b.userId, { db, now: T0, message: emoji });
    expect((await likeRow(a, b))?.intro?.body).toBe(emoji);
  });

  it("markup is stored as the text it is — never interpreted — and control characters are stripped", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await superLikeUser(a, b.userId, { db, now: T0, message: "<script>alert(1)</script><b>hi</b>\u0000\u0007" });
    expect((await likeRow(a, b))?.intro?.body).toBe("<script>alert(1)</script><b>hi</b>");
  });
});

// ───────────────────────────── The allowance ─────────────────────────────

describe("7–11 · five per window, transactionally", () => {
  it("7/8 · exactly five succeed in a window; the sixth is refused with when it resets, and creates nothing", async () => {
    const a = await man();
    const ws = await women(6);
    await plus(a);
    for (const [i, w] of ws.slice(0, 5).entries()) {
      const r = await superLikeUser(a, w.userId, { db, now: at(T0, minutes(i)) });
      expect(r.likesRemaining).toBe(4 - i);
    }
    const sixth = superLikeUser(a, ws[5]!.userId, { db, now: at(T0, minutes(10)), message: "one more" });
    await expect(sixth).rejects.toBeInstanceOf(SuperLikeLimitReachedError);
    await expect(sixth).rejects.toMatchObject({ limit: 5, resetsAt: new Date(T0.getTime() + WEEK) });
    expect(await likeRow(a, ws[5]!)).toBeNull();
    expect(await db.intro.count()).toBe(0);
    expect(await db.like.count({ where: { fromUserId: a.userId, kind: "SUPER" } })).toBe(5);
    expect(await superUsed(a.userId)).toBe(5);
  });

  it("the exact-one-left case: the fifth goes through and leaves zero", async () => {
    const a = await man();
    const ws = await women(5);
    await plus(a);
    for (const w of ws.slice(0, 4)) await superLikeUser(a, w.userId, { db, now: T0 });
    expect((await getSuperLikeAllowance(db, a.userId, T0)).remaining).toBe(1);
    const r = await superLikeUser(a, ws[4]!.userId, { db, now: T0 });
    expect(r.likesRemaining).toBe(0);
  });

  it("9 · concurrent 5th and 6th sends cannot exceed five — and neither can a burst from zero", async () => {
    const a = await man();
    const ws = await women(12);
    await plus(a);
    for (const w of ws.slice(0, 4)) await superLikeUser(a, w.userId, { db, now: T0 });
    const pair = await Promise.allSettled([superLikeUser(a, ws[4]!.userId, { db, now: T0 }), superLikeUser(a, ws[5]!.userId, { db, now: T0 })]);
    expect(pair.filter((p) => p.status === "fulfilled")).toHaveLength(1);
    expect(pair.filter((p) => p.status === "rejected" && p.reason instanceof SuperLikeLimitReachedError)).toHaveLength(1);
    expect(await superUsed(a.userId)).toBe(5);

    // A second member: eight tabs at once from a fresh window.
    const b = await man();
    await plus(b);
    const burst = await Promise.allSettled(ws.slice(4, 12).map((w) => superLikeUser(b, w.userId, { db, now: T0 })));
    expect(burst.filter((p) => p.status === "fulfilled")).toHaveLength(5);
    expect(await db.like.count({ where: { fromUserId: b.userId, kind: "SUPER" } })).toBe(5);
    expect(await superUsed(b.userId)).toBe(5);
  });

  it("10 · a failed send consumes nothing: blocked, other pool, already liked, paused, gone", async () => {
    const a = await man();
    const blocked = await woman();
    const friend = await woman({ connectionIntent: "FRIENDSHIP", friendshipInterestedIn: "EVERYONE", interestedIn: "EVERYONE" });
    const liked = await woman();
    const suspended = await woman();
    await plus(a);
    await blockUser(blocked, a.userId, { db, now: T0 });
    await likeUser(a, liked.userId, { db, now: T0 });
    await db.user.update({ where: { id: suspended.userId }, data: { status: "SUSPENDED" } });

    await expect(superLikeUser(a, blocked.userId, { db, now: at(T0, 1) })).rejects.toBeInstanceOf(NotFoundError);
    await expect(superLikeUser(a, friend.userId, { db, now: at(T0, 1) })).rejects.toThrow();
    await expect(superLikeUser(a, liked.userId, { db, now: at(T0, 1), message: "again" })).rejects.toThrow(ALREADY_LIKED);
    await expect(superLikeUser(a, suspended.userId, { db, now: at(T0, 1) })).rejects.toBeInstanceOf(NotFoundError);
    expect(await superSpent(a.userId)).toBe(0);
    expect(await db.intro.count()).toBe(0);

    // Paused: refused before anything is locked.
    const other = await woman();
    await db.privacySettings.update({ where: { userId: a.userId }, data: { pausedAt: T0 } });
    await expect(superLikeUser(a, other.userId, { db, now: at(T0, 2) })).rejects.toBeInstanceOf(InvalidStateError);
    expect(await superSpent(a.userId)).toBe(0);
  });

  it("11 · a retry — sequential or concurrent — is one Super Like, one spend, one message, one notification", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    const first = await superLikeUser(a, b.userId, { db, now: T0, message: "hello" });
    const again = await superLikeUser(a, b.userId, { db, now: at(T0, 1000), message: "hello" });
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, kind: "SUPER" });

    const c = await woman();
    const storm = await Promise.allSettled([0, 1, 2, 3].map(() => superLikeUser(a, c.userId, { db, now: at(T0, 2000), message: "hey" })));
    expect(storm.every((s) => s.status === "fulfilled")).toBe(true);
    expect(storm.filter((s) => s.status === "fulfilled" && s.value.created)).toHaveLength(1);

    expect(await db.like.count({ where: { fromUserId: a.userId } })).toBe(2);
    expect(await db.intro.count()).toBe(2);
    expect(await superUsed(a.userId)).toBe(2);
    expect(await db.notification.count({ where: { type: "LIKE_RECEIVED" } })).toBe(2);
  });
});

// ───────────────────────────── Likes You ─────────────────────────────

describe("12–17 · what the recipient receives", () => {
  it("12/17 · a Plus recipient sees the sender, the ⭐ and the message", async () => {
    const a = await man({ name: "Ahmed" });
    const b = await woman();
    await plus(a);
    await plus(b);
    await superLikeUser(a, b.userId, { db, now: T0, message: "Your diving photo got my attention 😄" });
    const p = plusPage(await page(b));
    expect(p.count).toBe(1);
    expect(p.cards.map((c) => [c.handle, c.name])).toEqual([[a.handle, "Ahmed"]]);
    expect(p.superLikes).toEqual({ [a.handle]: { message: "Your diving photo got my attention 😄" } });
  });

  it("13 · Super Likes come before ordinary likes, newest first within each group, deterministically", async () => {
    const b = await woman();
    await plus(b);
    const [n1, s1, n2, s2] = await Promise.all([man({ name: "N1" }), man({ name: "S1" }), man({ name: "N2" }), man({ name: "S2" })]);
    await plus(s1!);
    await plus(s2!);
    await likeUser(n1!, b.userId, { db, now: T0 });
    await superLikeUser(s1!, b.userId, { db, now: at(T0, minutes(1)) });
    await likeUser(n2!, b.userId, { db, now: at(T0, minutes(2)) });
    await superLikeUser(s2!, b.userId, { db, now: at(T0, minutes(3)) });
    const order = plusPage(await page(b)).cards.map((c) => c.name);
    expect(order).toEqual(["S2", "S1", "N2", "N1"]);
    expect(plusPage(await page(b)).cards.map((c) => c.name)).toEqual(order);
  });

  it("14 · a Free recipient gets the locked version: the count, and that a Super Like (with a message) exists", async () => {
    const a = await man();
    const c = await man();
    const b = await woman();
    await plus(a);
    await superLikeUser(a, b.userId, { db, now: T0, message: "hi there" });
    await likeUser(c, b.userId, { db, now: at(T0, 1000) });
    const p = freePage(await page(b));
    expect(p).toMatchObject({ tier: "FREE", count: 2, cards: null, superLikes: { count: 1, withMessage: 1 } });
    expect(await getLikesYou(b, { db, now: at(T0, minutes(1)) })).toEqual({ tier: "FREE", count: 2, superLikes: 1, superLikesWithMessage: 1 });
  });

  it("15/16 · the Free payload — Likes You, the Discover card, the bell — has nothing identifying and never the message", async () => {
    const a = await man({ name: "Ahmed Secretname", age: 31 });
    await db.profile.update({ where: { userId: a.userId }, data: { bio: "Diver and night-fisher", occupation: "Boat captain" } });
    const b = await woman();
    await plus(a);
    const message = "Your diving photo got my attention 😄";
    await superLikeUser(a, b.userId, { db, now: T0, message });

    const photos = await db.profilePhoto.findMany({ where: { profile: { userId: a.userId } }, select: { blurhash: true, storageKey: true, thumbKey: true } });
    const leaks = ["Ahmed", "Secretname", a.handle, a.userId, "Diver", "Boat captain", "31", message, "diving", ...photos.flatMap((ph) => [ph.blurhash, ph.storageKey, ph.thumbKey])];
    const likesPage = JSON.stringify(await page(b));
    const likesYou = JSON.stringify(await getLikesYou(b, { db, now: at(T0, minutes(1)) }));
    const feed = JSON.stringify(await getNotificationFeed(b, {}, { db, storage, now: at(T0, minutes(1)) }));
    for (const leak of leaks) {
      expect(likesPage).not.toContain(leak);
      expect(likesYou).not.toContain(leak);
      expect(feed).not.toContain(leak);
    }
    // A in B's Discover deck is just a card: nothing on it says they Super Liked B, and no message rides along.
    const deck = await getDeck(b, {}, { db, storage, now: at(T0, minutes(1)) });
    const card = deck.cards.find((c) => c.handle === a.handle);
    expect(card).toBeDefined();
    expect(JSON.stringify(deck.cards)).not.toMatch(/super/i);
    expect(JSON.stringify(deck)).not.toContain(message);
  });
});

// ───────────────────────────── Sent ─────────────────────────────

describe("18–19 · the sender's Sent list", () => {
  it("18/19 · the sender sees the Super Like and their own message; an ordinary like carries no mark", async () => {
    const a = await man();
    const [b, c] = await women(2);
    await plus(a);
    await superLikeUser(a, b!.userId, { db, now: T0, message: "You seem fun — had to say hi 😄" });
    await likeUser(a, c!.userId, { db, now: at(T0, 1000) });
    const p = await page(a);
    expect(p.sent.count).toBe(2);
    expect(p.sent.cards.map((x) => x.handle)).toEqual([c!.handle, b!.handle]);
    expect(p.sent.superLikes).toEqual({ [b!.handle]: { message: "You seem fun — had to say hi 😄" } });
  });
});

// ───────────────────────────── Like back → match ─────────────────────────────

describe("20–24 · like back", () => {
  async function superThenLikeBack() {
    const a = await man({ name: "Ahmed" });
    const b = await woman({ name: "Hind" });
    await plus(a);
    await plus(b);
    await superLikeUser(a, b.userId, { db, now: T0, message: "Your diving photo got my attention 😄" });
    const back = await likeUser(b, a.userId, { db, now: at(T0, minutes(5)) });
    return { a, b, back };
  }

  it("20/21 · a like back creates exactly one Match and one Conversation", async () => {
    const { back } = await superThenLikeBack();
    expect(back).toMatchObject({ created: true, matched: true, introsDelivered: 1 });
    expect(await db.match.count()).toBe(1);
    expect(await db.conversation.count()).toBe(1);
  });

  it("22 · the message is the conversation's first message, from the sender, exactly once — however often it is retried", async () => {
    const { a, b, back } = await superThenLikeBack();
    // Every way of going round again: the like back repeated, the Super Like retried, both at once.
    await likeUser(b, a.userId, { db, now: at(T0, minutes(6)) });
    await Promise.allSettled([superLikeUser(a, b.userId, { db, now: at(T0, minutes(7)), message: "x" }), likeUser(b, a.userId, { db, now: at(T0, minutes(7)) })]);
    const messages = await db.message.findMany({ where: { conversationId: back.conversationId! }, orderBy: { createdAt: "asc" } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ senderId: a.userId, kind: "INTRO", body: "Your diving photo got my attention 😄", createdAt: T0 });
    expect((await db.intro.findFirstOrThrow()).messageId).toBe(messages[0]!.id);
    // The recipient sees it as their partner's message in the ordinary chat read model.
    const thread = await listMessages(b, back.conversationId!, { db, now: at(T0, minutes(8)) });
    expect(thread.messages.map((m) => [m.kind, m.fromMe, m.body])).toEqual([["INTRO", false, "Your diving photo got my attention 😄"]]);
  });

  it("23/24 · after the match it leaves the recipient's Likes You and the sender's Sent", async () => {
    const { a, b } = await superThenLikeBack();
    const pb = await page(b, at(T0, minutes(10)));
    const pa = await page(a, at(T0, minutes(10)));
    expect(pb.count).toBe(0);
    expect(pa.sent).toEqual({ count: 0, cards: [], superLikes: {} });
    expect(pb.matches.map((m) => m.handle)).toEqual([a.handle]);
    expect(pa.matches.map((m) => m.handle)).toEqual([b.handle]);
  });

  it("a Super Like without a message matches with an empty conversation", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await superLikeUser(a, b.userId, { db, now: T0 });
    const back = await likeUser(b, a.userId, { db, now: at(T0, 1000) });
    expect(back).toMatchObject({ matched: true, introsDelivered: 0 });
    expect(await db.message.count()).toBe(0);
  });

  it("a Super Like to somebody who already liked you matches at once, with the message in the new chat", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await likeUser(b, a.userId, { db, now: T0 });
    const r = await superLikeUser(a, b.userId, { db, now: at(T0, 1000), message: "Saw you liked me 🙂" });
    expect(r).toMatchObject({ created: true, matched: true, kind: "SUPER" });
    expect(await db.message.findMany({ select: { kind: true, body: true, senderId: true } })).toEqual([{ kind: "INTRO", body: "Saw you liked me 🙂", senderId: a.userId }]);
    // Matched on the spot: no "Super Liked you" alert to B on top of the match.
    expect(await db.notification.count({ where: { type: "LIKE_RECEIVED", userId: b.userId } })).toBe(0);
  });

  it("a like back racing the Super Like: one match, one conversation, one message", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await Promise.allSettled([superLikeUser(a, b.userId, { db, now: T0, message: "race" }), likeUser(b, a.userId, { db, now: T0 })]);
    expect(await db.match.count()).toBe(1);
    expect(await db.conversation.count()).toBe(1);
    expect(await db.message.count({ where: { kind: "INTRO" } })).toBe(1);
  });

  it("an existing match or pending normal like is never upgraded: refused, nothing spent", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await likeUser(a, b.userId, { db, now: T0 });
    await likeUser(b, a.userId, { db, now: T0 });
    await expect(superLikeUser(a, b.userId, { db, now: at(T0, 1000), message: "hi" })).rejects.toThrow();
    expect((await likeRow(a, b))?.kind).toBe("NORMAL");
    expect(await superSpent(a.userId)).toBe(0);
    expect(await db.message.count()).toBe(0);
  });
});

// ───────────────────────────── Dismissal ─────────────────────────────

describe("25–26 · pass on a Super Like", () => {
  it("25/26 · Pass from Likes You sets Like.dismissedAt; no match, no chat, no refund, nothing for the sender", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await plus(b);
    await superLikeUser(a, b.userId, { db, now: T0, message: "hi" });
    const notificationsBefore = await db.notification.count();
    await passUser(b, a.userId, { db, now: at(T0, minutes(1)), dismissIncomingLike: true });

    const row = await likeRow(a, b);
    expect(row).toMatchObject({ kind: "SUPER", dismissedAt: at(T0, minutes(1)) });
    expect(row?.intro?.messageId).toBeNull();
    expect((await page(b, at(T0, minutes(2)))).count).toBe(0);
    expect(await db.match.count()).toBe(0);
    expect(await db.conversation.count()).toBe(0);
    expect(await db.notification.count()).toBe(notificationsBefore);
    // No refund, and the sender's Sent looks exactly as before: it never reveals a "no".
    expect(await superUsed(a.userId)).toBe(1);
    const pa = await page(a, at(T0, minutes(2)));
    expect(pa.sent.superLikes).toEqual({ [b.handle]: { message: "hi" } });
  });
});

// ───────────────────────────── Safety ─────────────────────────────

describe("27–30 · the same safety rules as a like", () => {
  it("27 · a block (either way) removes the Super Like from Likes You and Sent, and no match can follow", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await plus(b);
    await superLikeUser(a, b.userId, { db, now: T0, message: "private words" });
    await blockUser(b, a.userId, { db, now: at(T0, minutes(1)) });
    const pb = plusPage(await page(b, at(T0, minutes(2))));
    const pa = await page(a, at(T0, minutes(2)));
    expect(pb.count).toBe(0);
    expect(pb.superLikes).toEqual({});
    expect(pa.sent).toEqual({ count: 0, cards: [], superLikes: {} });
    for (const json of [JSON.stringify(pb), JSON.stringify(await getNotificationFeed(b, {}, { db, storage, now: at(T0, minutes(2)) }))]) expect(json).not.toContain("private words");
    await expect(likeUser(b, a.userId, { db, now: at(T0, minutes(3)) })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.match.count()).toBe(0);
    expect(await db.message.count()).toBe(0);
  });

  it("a block landing while the Super Like is in flight: either it was never sent, or it is hidden — never a match", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await Promise.allSettled([superLikeUser(a, b.userId, { db, now: T0, message: "m" }), blockUser(b, a.userId, { db, now: T0 })]);
    expect((await page(b)).count).toBe(0);
    expect((await page(a)).sent.count).toBe(0);
    expect(await db.match.count()).toBe(0);
  });

  it("28 · Dating and Friendship stay separate: no Super Like across pools, and a later switch hides it", async () => {
    const a = await man();
    const friend = await woman({ connectionIntent: "FRIENDSHIP", friendshipInterestedIn: "EVERYONE", interestedIn: "EVERYONE" });
    const b = await woman();
    await plus(a);
    await expect(superLikeUser(a, friend.userId, { db, now: T0, message: "hi" })).rejects.toThrow();
    expect(await superSpent(a.userId)).toBe(0);
    await superLikeUser(a, b.userId, { db, now: T0 });
    await db.discoveryPreferences.update({ where: { userId: b.userId }, data: { connectionIntent: "FRIENDSHIP", friendshipInterestedIn: "EVERYONE", interestedIn: "EVERYONE" } });
    expect((await page(b)).count).toBe(0);
    expect((await page(a)).sent.count).toBe(0);
  });

  it("29 · Invisible Mode holds: a hidden Plus member who has not liked you cannot be Super Liked", async () => {
    const a = await man();
    const ghost = await woman();
    await plus(a);
    await plus(ghost);
    await setInvisibleMode(ghost, true, { db, now: T0 });
    await expect(superLikeUser(a, ghost.userId, { db, now: at(T0, 1000), message: "found you" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await superSpent(a.userId)).toBe(0);
    expect(await db.intro.count()).toBe(0);
  });

  it("30 · staff accounts can neither send nor receive one", async () => {
    const a = await man();
    const staff = await createStaff(db, { now: T0 });
    await plus(a);
    await grantPlus(db, staff.userId, at(T0, -hours(1)), at(T0, DAY));
    await expect(superLikeUser({ userId: staff.userId }, a.userId, { db, now: T0 })).rejects.toThrow();
    await expect(superLikeUser(a, staff.userId, { db, now: T0 })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.like.count()).toBe(0);
    expect(await superSpent(a.userId)).toBe(0);
  });

  it("a suspended or banned sender has no member session to send from, exactly as for likes", async () => {
    // Suspension is enforced where it is for every member action: the account classifies as "blocked", which
    // requireMember refuses and which ends its sessions (src/server/auth/session.ts). And a suspended recipient is
    // simply not there (10 above).
    for (const status of ["SUSPENDED", "BANNED", "DELETED"] as const) expect(authKindForUser({ status, onboardingCompletedAt: T0, accountType: "MEMBER" })).toBe("blocked");
  });
});

// ───────────────────────────── Plus expiry, reset, renewal ─────────────────────────────

describe("31–34 · expiry and the window", () => {
  it("31 · expired Plus cannot send — not even with Super Likes left in the window (e.g. the composer was open)", async () => {
    const a = await man();
    const [b, c] = await women(2);
    await plus(a, at(T0, -hours(1)), at(T0, DAY));
    await superLikeUser(a, b!.userId, { db, now: T0 });
    const later = at(T0, 2 * DAY);
    await expect(superLikeUser(a, c!.userId, { db, now: later, message: "still here?" })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect(await getSuperLikeAllowance(db, a.userId, later)).toMatchObject({ limit: 0, remaining: 0, tier: "FREE" });
    expect(await superUsed(a.userId)).toBe(1);
    expect(await likeRow(a, c!)).toBeNull();
  });

  it("32 · a Super Like sent before expiry stays valid: shown with its message, and a like back still matches with it", async () => {
    const a = await man({ name: "Ahmed" });
    const b = await woman();
    await plus(a, at(T0, -hours(1)), at(T0, DAY));
    await plus(b);
    await superLikeUser(a, b.userId, { db, now: T0, message: "before it lapsed" });
    const later = at(T0, 3 * DAY);
    expect(plusPage(await page(b, later)).superLikes).toEqual({ [a.handle]: { message: "before it lapsed" } });
    expect((await page(a, later)).sent.superLikes).toEqual({ [b.handle]: { message: "before it lapsed" } });
    const back = await likeUser(b, a.userId, { db, now: later });
    expect(back).toMatchObject({ matched: true, introsDelivered: 1 });
  });

  it("33 · the allowance resets when the 7-day window ends", async () => {
    const a = await man();
    const ws = await women(6);
    await plus(a);
    for (const w of ws.slice(0, 5)) await superLikeUser(a, w.userId, { db, now: T0 });
    await expect(superLikeUser(a, ws[5]!.userId, { db, now: at(T0, WEEK - 1) })).rejects.toBeInstanceOf(SuperLikeLimitReachedError);
    const next = at(T0, WEEK);
    expect(await getSuperLikeAllowance(db, a.userId, next)).toMatchObject({ remaining: 5, used: 0, resetsAt: null });
    const r = await superLikeUser(a, ws[5]!.userId, { db, now: next });
    expect(r).toMatchObject({ created: true, likesRemaining: 4 });
    expect(r.likesResetAt.getTime()).toBe(next.getTime() + WEEK);
  });

  it("34 · unused Super Likes do not roll over: two used, then a new window still holds five, not eight", async () => {
    const a = await man();
    const ws = await women(8);
    await plus(a);
    for (const w of ws.slice(0, 2)) await superLikeUser(a, w.userId, { db, now: T0 });
    const next = at(T0, WEEK + hours(1));
    for (const w of ws.slice(2, 7)) await superLikeUser(a, w.userId, { db, now: next });
    await expect(superLikeUser(a, ws[7]!.userId, { db, now: next })).rejects.toBeInstanceOf(SuperLikeLimitReachedError);
  });

  it("renewal keeps the window it is in: renewing Plus neither resets nor extends it", async () => {
    const a = await man();
    const ws = await women(6);
    await createSubscription(db, a.userId, { status: "ACTIVE", periodStart: at(T0, -DAY), periodEnd: at(T0, 2 * DAY) });
    for (const w of ws.slice(0, 5)) await superLikeUser(a, w.userId, { db, now: T0 });
    await createSubscription(db, a.userId, { status: "ACTIVE", periodStart: at(T0, 2 * DAY), periodEnd: at(T0, 32 * DAY) });
    const renewed = at(T0, 3 * DAY);
    expect(await getSuperLikeAllowance(db, a.userId, renewed)).toMatchObject({ limit: 5, remaining: 0, resetsAt: new Date(T0.getTime() + WEEK) });
    await expect(superLikeUser(a, ws[5]!.userId, { db, now: renewed })).rejects.toBeInstanceOf(SuperLikeLimitReachedError);
    await superLikeUser(a, ws[5]!.userId, { db, now: at(T0, WEEK) });
  });

  it("Plus lapsing mid-window and returning: the same window, with what was left of it", async () => {
    const a = await man();
    const ws = await women(4);
    await plus(a, at(T0, -hours(1)), at(T0, DAY));
    for (const w of ws.slice(0, 2)) await superLikeUser(a, w.userId, { db, now: T0 });
    await plus(a, at(T0, 3 * DAY), at(T0, 40 * DAY));
    expect(await getSuperLikeAllowance(db, a.userId, at(T0, 3 * DAY))).toMatchObject({ limit: 5, remaining: 3, resetsAt: new Date(T0.getTime() + WEEK) });
  });
});

// ───────────────────────────── Notifications ─────────────────────────────

describe("35–37 · notifications", () => {
  it("35 · exactly one notification — two booleans, never the message — and no second alert on the match", async () => {
    const a = await man();
    const b = await woman();
    await plus(a);
    await superLikeUser(a, b.userId, { db, now: T0, message: "secret words" });
    await superLikeUser(a, b.userId, { db, now: at(T0, 1000), message: "secret words" });
    const rows = await db.notification.findMany({ where: { userId: b.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "LIKE_RECEIVED", actorId: a.userId, data: { superLike: true, withMessage: true } });
    expect(JSON.stringify(rows)).not.toContain("secret words");

    await likeUser(b, a.userId, { db, now: at(T0, minutes(1)) });
    const after = await db.notification.findMany({ select: { userId: true, type: true } });
    // One NEW_MATCH each; the intro in the chat is not a MESSAGE alert (no push, no email) on top of the match.
    expect(after.filter((n) => n.type === "NEW_MATCH")).toHaveLength(2);
    expect(after.filter((n) => n.type === "MESSAGE")).toHaveLength(0);
    expect(after.filter((n) => n.type === "LIKE_RECEIVED")).toHaveLength(1);
  });

  it("36 · a Free recipient's bell and push say 'Someone Super Liked you' — no name, no photo, no message", async () => {
    const a = await man({ name: "Hind" });
    const b = await woman();
    await plus(a);
    await superLikeUser(a, b.userId, { db, now: T0, message: "secret words" });
    const feed = await getNotificationFeed(b, {}, { db, storage, now: at(T0, 1000) });
    const item = feed.items.find((i) => i.type === "LIKE_RECEIVED");
    expect(item).toMatchObject({ title: "Someone Super Liked you and sent a message ⭐", actorName: null, photo: null });
    expect(JSON.stringify(feed)).not.toMatch(/Hind|secret words/);
    const push = pushCopyFor({ kind: "LIKE_RECEIVED", actorName: null, superLike: { withMessage: true } });
    expect(push).toEqual({ title: "Someone Super Liked you and sent a message ⭐", body: "Open MelloCrush to find out who" });
    expect(pushCopyFor({ kind: "LIKE_RECEIVED", actorName: null, superLike: { withMessage: false } }).title).toBe("Someone Super Liked you ⭐");
  });

  it("37 · a Plus recipient's bell names the sender as it does for likes; push stays anonymous, as for likes", async () => {
    const a = await man({ name: "Hind" });
    const b = await woman();
    await plus(a);
    await plus(b);
    await superLikeUser(a, b.userId, { db, now: T0, message: "secret words" });
    const feed = await getNotificationFeed(b, {}, { db, storage, now: at(T0, 1000) });
    expect(feed.items.find((i) => i.type === "LIKE_RECEIVED")).toMatchObject({ title: "Hind Super Liked you and sent a message ⭐", actorName: "Hind" });
    expect(JSON.stringify(feed)).not.toContain("secret words");
    // Existing rule: a like push never names the liker, whatever the tier, and never carries a message.
    const push = pushCopyFor({ kind: "LIKE_RECEIVED", actorName: "Hind", superLike: { withMessage: true } });
    expect(push.title).not.toContain("Hind");
    expect(JSON.stringify(push)).not.toContain("secret words");
  });
});

// ───────────────────────────── Nothing else changed ─────────────────────────────

describe("38–40 · likes, Likes You and messaging behave as before", () => {
  it("38 · normal likes are unchanged: NORMAL, the daily allowance, a plain notification — and a Super Like spends no daily like", async () => {
    const a = await man();
    const [b, c] = await women(2);
    await plus(a);
    const liked = await likeUser(a, b!.userId, { db, now: T0 });
    expect(liked).toMatchObject({ created: true, kind: "NORMAL", likesRemaining: 89 });
    expect((await likeRow(a, b!))).toMatchObject({ kind: "NORMAL", introId: null });
    expect((await db.notification.findFirstOrThrow({ where: { userId: b!.userId } })).data).toBeNull();
    await superLikeUser(a, c!.userId, { db, now: at(T0, 1000) });
    const likes = await db.usageCounter.findUniqueOrThrow({ where: { userId_kind: { userId: a.userId, kind: "LIKES" } } });
    expect(likes.used).toBe(1);
    // A normal like after a Super Like is the same idempotent success it always was — it never downgrades it.
    expect(await likeUser(a, c!.userId, { db, now: at(T0, 2000) })).toMatchObject({ created: false, kind: "SUPER" });
    expect((await likeRow(a, c!))?.kind).toBe("SUPER");
  });

  it("39 · a Likes You with no Super Likes has the same cards as before and an empty mark list", async () => {
    const a = await man({ name: "Ahmed" });
    const b = await woman();
    await plus(b);
    await likeUser(a, b.userId, { db, now: T0 });
    const p = plusPage(await page(b));
    expect(p.cards.map((c) => c.handle)).toEqual([a.handle]);
    expect(p.superLikes).toEqual({});
    expect(p.sent).toEqual({ count: 0, cards: [], superLikes: {} });
  });

  it("40 · matching and messaging are intact: a normal match starts empty, and chat works after a Super Like match", async () => {
    const a = await man();
    const b = await woman();
    await likeUser(a, b.userId, { db, now: T0 });
    const m = await likeUser(b, a.userId, { db, now: at(T0, 1000) });
    expect(m).toMatchObject({ matched: true, introsDelivered: 0 });
    expect(await db.message.count()).toBe(0);

    const c = await man();
    const d = await woman();
    await plus(c);
    await superLikeUser(c, d.userId, { db, now: T0, message: "first" });
    const back = await likeUser(d, c.userId, { db, now: at(T0, minutes(1)) });
    await sendMessage(d, back.conversationId!, "second", { db, now: at(T0, minutes(2)) });
    await sendMessage(c, back.conversationId!, "third", { db, now: at(T0, minutes(3)) });
    const thread = await listMessages(c, back.conversationId!, { db, now: at(T0, minutes(4)) });
    expect(thread.messages.map((x) => [x.kind, x.body]).reverse()).toEqual([["INTRO", "first"], ["TEXT", "second"], ["TEXT", "third"]]);
    // The intro is not editable: only TEXT messages are.
    expect(await db.message.count({ where: { kind: "INTRO" } })).toBe(1);
  });
});

// ───────────────────────────── Membership and analytics ─────────────────────────────

describe("Membership and analytics", () => {
  it("Membership lists Super Likes as a Plus benefit, and shows a Plus member what is left", async () => {
    const a = await man();
    const [b, c] = await women(2);
    const free = await getMembership(a, { db, now: T0 });
    expect(free.superLikes).toBeNull();
    expect(free.comparison.find((r) => r.key === "super-likes")).toMatchObject({ capability: "Super Likes ⭐", detail: "Send a message with your Super Like", free: { kind: "excluded" }, plus: { kind: "text", text: "5 every 7 days" } });
    await plus(a);
    await superLikeUser(a, b!.userId, { db, now: T0 });
    await superLikeUser(a, c!.userId, { db, now: T0 });
    const m = await getMembership(a, { db, now: at(T0, 3 * DAY) });
    expect(m.superLikes).toMatchObject({ limit: 5, remaining: 3, left: "3 of 5 Super Likes left", reset: "Resets in 4 days" });
  });

  describe("with PLUS_FUNNEL_ANALYTICS on", () => {
    const previous = process.env.PLUS_FUNNEL_ANALYTICS;
    beforeEach(() => {
      process.env.PLUS_FUNNEL_ANALYTICS = "on";
    });
    afterEach(() => {
      if (previous === undefined) delete process.env.PLUS_FUNNEL_ANALYTICS;
      else process.env.PLUS_FUNNEL_ANALYTICS = previous;
    });

    async function eventsFor(n: number) {
      for (let i = 0; i < 50; i++) {
        const rows = await db.plusFunnelEvent.findMany({ orderBy: { createdAt: "asc" } });
        if (rows.length >= n) return rows;
        await new Promise((r) => setTimeout(r, 40));
      }
      return db.plusFunnelEvent.findMany();
    }

    it("records sent / with-message / matched once each, with no message content anywhere", async () => {
      const a = await man();
      const b = await woman();
      await plus(a);
      await superLikeByHandle(a, b.handle, "secret words", { db, storage, now: T0 });
      await likeByHandle(b, a.handle, { db, storage, now: at(T0, 1000) });
      const rows = await eventsFor(3);
      expect(rows.map((r) => r.event).sort()).toEqual(["super_like_matched", "super_like_sent", "super_like_with_message_sent"]);
      expect(rows.every((r) => r.surface === "super_like" && r.userId === a.userId)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("secret words");
    });
  });
});

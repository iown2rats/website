import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NOTIFICATION_FEED } from "@/config/product";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { sendMessage } from "@/server/conversations/messages";
import { likeUser } from "@/server/likes/like";
import {
  countUnreadNotifications,
  getNotificationFeed,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/notifications/feed";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

const db = testDb();
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const T0 = new Date("2026-09-17T20:00:00Z");
const deps = { db, storage, now: T0 };

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

async function match(a: TestUser, b: TestUser, now = T0): Promise<string> {
  await likeUser(a, b.userId, { db, now });
  const r = await likeUser(b, a.userId, { db, now });
  if (!r.matched || !r.conversationId) throw new Error("expected a match");
  return r.conversationId;
}

/** A raw row, so the reader is tested independently of which producer happens to create that type today. */
function notify(
  userId: string,
  type: "NEW_MATCH" | "MESSAGE" | "LIKE_RECEIVED" | "INTRO_RECEIVED" | "COMMUNITY_LIKE" | "COMMUNITY_COMMENT" | "VERIFICATION_UPDATE" | "SAFETY_NOTICE" | "ACCOUNT_NOTICE" | "PAYMENT_APPROVED" | "PAYMENT_REJECTED" | "SUBSCRIPTION_EXPIRING" | "SUBSCRIPTION_EXPIRED",
  extra: { actorId?: string; conversationId?: string; postId?: string; data?: object; createdAt?: Date; readAt?: Date } = {},
) {
  return db.notification.create({
    data: { userId, type, createdAt: extra.createdAt ?? T0, ...extra },
    select: { id: true },
  });
}

async function post(authorId: string, body = "Hello Malé") {
  return db.communityPost.create({ data: { authorId, body, createdAt: T0 }, select: { id: true } });
}

describe("unread counts", () => {
  it("counts only this user's unread rows", async () => {
    const [me, other] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await notify(me.userId, "ACCOUNT_NOTICE");
    await notify(me.userId, "SAFETY_NOTICE");
    await notify(me.userId, "ACCOUNT_NOTICE", { readAt: T0 });
    await notify(other.userId, "ACCOUNT_NOTICE");

    expect(await countUnreadNotifications(me, { db })).toBe(2);
    expect(await countUnreadNotifications(other, { db })).toBe(1);
  });

  it("is zero with no rows, and the feed reports it alongside the items", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed).toEqual({ items: [], unread: 0, nextCursor: null });
  });

  it("the feed's count is the whole account, not just the page", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    for (let i = 0; i < 8; i += 1) await notify(me.userId, "ACCOUNT_NOTICE", { createdAt: at(T0, -minutes(i)) });
    const feed = await getNotificationFeed(me, { limit: 3 }, deps);
    expect(feed.items).toHaveLength(3);
    expect(feed.unread).toBe(8);
  });
});

describe("ownership and authorization", () => {
  it("the feed never returns another user's rows", async () => {
    const [me, other] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const mine = await notify(me.userId, "ACCOUNT_NOTICE");
    await notify(other.userId, "SAFETY_NOTICE");

    const feed = await getNotificationFeed(me, { limit: 50 }, deps);
    expect(feed.items.map((n) => n.id)).toEqual([mine.id]);
  });

  it("marking another user's notification read changes nothing and says nothing", async () => {
    const [me, other] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const theirs = await notify(other.userId, "ACCOUNT_NOTICE");

    const result = await markNotificationRead(me, theirs.id, { db, now: T0 });
    expect(result).toEqual({ changed: false, unread: 0 });
    expect((await db.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
  });

  it("a nonexistent id is indistinguishable from someone else's id", async () => {
    const [me, other] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const theirs = await notify(other.userId, "ACCOUNT_NOTICE");

    const foreign = await markNotificationRead(me, theirs.id, { db, now: T0 });
    const missing = await markNotificationRead(me, "cm0000000000000000000000", { db, now: T0 });
    expect(foreign).toEqual(missing);
  });

  it("mark-all only touches the caller's rows", async () => {
    const [me, other] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await notify(me.userId, "ACCOUNT_NOTICE");
    await notify(me.userId, "SAFETY_NOTICE");
    const theirs = await notify(other.userId, "ACCOUNT_NOTICE");

    expect(await markAllNotificationsRead(me, { db, now: T0 })).toEqual({ marked: 2, unread: 0 });
    expect((await db.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
    expect(await countUnreadNotifications(other, { db })).toBe(1);
  });
});

describe("marking read", () => {
  it("marks one row and leaves the rest unread", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const first = await notify(me.userId, "ACCOUNT_NOTICE", { createdAt: T0 });
    await notify(me.userId, "SAFETY_NOTICE", { createdAt: at(T0, -minutes(5)) });

    const result = await markNotificationRead(me, first.id, { db, now: at(T0, minutes(1)) });
    expect(result).toEqual({ changed: true, unread: 1 });
    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items.map((n) => n.read)).toEqual([true, false]);
  });

  it("marking an already-read row again is a no-op that does not move the timestamp", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const row = await notify(me.userId, "ACCOUNT_NOTICE");
    await markNotificationRead(me, row.id, { db, now: T0 });
    const readAt = (await db.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt;

    const again = await markNotificationRead(me, row.id, { db, now: at(T0, hours(1)) });
    expect(again).toEqual({ changed: false, unread: 0 });
    expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).toEqual(readAt);
  });

  it("mark-all keeps every row — reading is not deleting", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await notify(me.userId, "ACCOUNT_NOTICE");
    await notify(me.userId, "SAFETY_NOTICE", { createdAt: at(T0, -minutes(1)) });

    await markAllNotificationsRead(me, { db, now: T0 });
    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items).toHaveLength(2);
    expect(feed.items.every((n) => n.read)).toBe(true);
    expect(feed.unread).toBe(0);
  });

  it("mark-all on an empty inbox reports nothing marked", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    expect(await markAllNotificationsRead(me, { db, now: T0 })).toEqual({ marked: 0, unread: 0 });
  });
});

describe("privacy: who a row may name", () => {
  it("a Free member's like row names nobody and carries no photo", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const liker = await createUser(db, { now: T0, name: "Hassan" });
    await notify(me.userId, "LIKE_RECEIVED", { actorId: liker.userId });

    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items[0]!.title).toBe("Someone liked you");
    expect(feed.items[0]!.actorName).toBeNull();
    expect(feed.items[0]!.photo).toBeNull();
    expect(feed.items[0]!.icon).toBe("like");
    const serialized = JSON.stringify(feed);
    expect(serialized).not.toContain("Hassan");
    expect(serialized).not.toContain(liker.userId);
    expect(serialized).not.toContain(liker.handle);
  });

  it("a Plus member's like row names the liker", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const liker = await createUser(db, { now: T0, name: "Hassan" });
    await notify(me.userId, "LIKE_RECEIVED", { actorId: liker.userId });

    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items[0]!.title).toBe("Hassan liked you");
    expect(feed.items[0]!.actorName).toBe("Hassan");
    expect(feed.items[0]!.photo).not.toBeNull();
  });

  it("an intro row follows the same paywall as a like", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const other = await createUser(db, { now: T0, name: "Zara" });
    await notify(me.userId, "INTRO_RECEIVED", { actorId: other.userId });
    expect((await getNotificationFeed(me, {}, deps)).items[0]!.title).toBe("Someone sent you an intro");

    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    expect((await getNotificationFeed(me, {}, deps)).items[0]!.title).toBe("Zara sent you an intro");
  });

  it("a Plus member is not told about a liker whose account is no longer active", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const liker = await createUser(db, { now: T0, name: "Hassan" });
    await notify(me.userId, "LIKE_RECEIVED", { actorId: liker.userId });
    await db.user.update({ where: { id: liker.userId }, data: { status: "BANNED" } });

    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items[0]!.title).toBe("Someone liked you");
    expect(JSON.stringify(feed)).not.toContain("Hassan");
  });

  it("a blocked member is never named, whatever the row is", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const them = await createUser(db, { now: T0, name: "Zara" });
    const p = await post(me.userId);
    await notify(me.userId, "COMMUNITY_COMMENT", { actorId: them.userId, postId: p.id });
    expect((await getNotificationFeed(me, {}, deps)).items[0]!.title).toBe("Zara commented on your post");

    await blockUser(me, them.userId, { db, now: T0 });
    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items[0]!.title).toBe("New comment on your post");
    expect(feed.items[0]!.photo).toBeNull();
    expect(JSON.stringify(feed)).not.toContain("Zara");
  });

  it("a block made by the other person hides them too", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const them = await createUser(db, { now: T0, name: "Zara" });
    const p = await post(me.userId);
    await notify(me.userId, "COMMUNITY_LIKE", { actorId: them.userId, postId: p.id });
    await blockUser(them, me.userId, { db, now: T0 });

    expect((await getNotificationFeed(me, {}, deps)).items[0]!.title).toBe("Someone liked your post");
  });

  it("a row never carries storage keys, ids or contact data", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const them = await createUser(db, { now: T0, name: "Zara" });
    const conv = await match(me, them);
    await sendMessage(them, conv, "Are you free tonight?", { db, now: T0 });

    const feed = await getNotificationFeed(me, { limit: 50 }, deps);
    for (const item of feed.items) {
      if (item.photo?.url) expect(item.photo.url).toMatch(/^\/api\/media\/.+\?exp=\d+&sig=/);
    }
    // A signed URL necessarily embeds the object path, so strip them before auditing the rest of the payload.
    const serialized = JSON.stringify({ ...feed, items: feed.items.map((n) => ({ ...n, photo: n.photo ? { ...n.photo, url: "<url>" } : null })) });
    for (const forbidden of ["storageKey", "thumbKey", "test/", "phoneE164", "phoneHash", "dateOfBirth", "readAt", "moderation", them.phoneE164, them.userId]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("message previews", () => {
  it("shows the latest line of a conversation the viewer is in", async () => {
    const [me, them] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0, name: "Zara" })];
    const conv = await match(me, them);
    await sendMessage(them, conv, "Are you free tonight?", { db, now: T0 });

    const feed = await getNotificationFeed(me, { limit: 50 }, deps);
    const message = feed.items.find((n) => n.type === "MESSAGE");
    expect(message?.title).toBe("Zara sent you a message");
    expect(message?.detail).toBe("Are you free tonight?");
    expect(message?.href).toBe(`/chats/${conv}`);
  });

  it("truncates a long preview", async () => {
    const [me, them] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(me, them);
    await sendMessage(them, conv, "a".repeat(400), { db, now: T0 });

    const message = (await getNotificationFeed(me, { limit: 50 }, deps)).items.find((n) => n.type === "MESSAGE");
    expect(message!.detail).toHaveLength(NOTIFICATION_FEED.previewChars);
    expect(message!.detail!.endsWith("…")).toBe(true);
  });

  it("skips a soft-deleted message rather than previewing it", async () => {
    const [me, them] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(me, them);
    await sendMessage(them, conv, "Secret plans", { db, now: T0 });
    await db.message.updateMany({ where: { conversationId: conv }, data: { deletedAt: T0 } });

    const message = (await getNotificationFeed(me, { limit: 50 }, deps)).items.find((n) => n.type === "MESSAGE");
    expect(message!.detail).toBeNull();
    expect(JSON.stringify(message)).not.toContain("Secret plans");
  });
});

describe("navigation targets", () => {
  it("routes each type to the screen that shows it", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const them = await createUser(db, { now: T0 });
    const conv = await match(me, them);
    const p = await post(me.userId);

    await db.notification.deleteMany({ where: { userId: me.userId } });
    await notify(me.userId, "MESSAGE", { conversationId: conv, actorId: them.userId, createdAt: at(T0, -minutes(1)) });
    await notify(me.userId, "NEW_MATCH", { conversationId: conv, actorId: them.userId, createdAt: at(T0, -minutes(2)) });
    await notify(me.userId, "LIKE_RECEIVED", { actorId: them.userId, createdAt: at(T0, -minutes(3)) });
    await notify(me.userId, "COMMUNITY_LIKE", { actorId: them.userId, postId: p.id, createdAt: at(T0, -minutes(4)) });
    await notify(me.userId, "VERIFICATION_UPDATE", { data: { status: "VERIFIED" }, createdAt: at(T0, -minutes(5)) });
    await notify(me.userId, "PAYMENT_APPROVED", { data: { planName: "1 month" }, createdAt: at(T0, -minutes(6)) });
    await notify(me.userId, "SUBSCRIPTION_EXPIRED", { createdAt: at(T0, -minutes(7)) });
    await notify(me.userId, "SAFETY_NOTICE", { createdAt: at(T0, -minutes(8)) });
    await notify(me.userId, "ACCOUNT_NOTICE", { createdAt: at(T0, -minutes(9)) });

    const feed = await getNotificationFeed(me, { limit: 50 }, deps);
    expect(feed.items.map((n) => [n.type, n.href])).toEqual([
      ["MESSAGE", `/chats/${conv}`],
      ["NEW_MATCH", `/chats/${conv}`],
      ["LIKE_RECEIVED", "/likes"],
      ["COMMUNITY_LIKE", `/community/${p.id}`],
      ["VERIFICATION_UPDATE", "/settings/verification"],
      ["PAYMENT_APPROVED", "/settings/membership"],
      ["SUBSCRIPTION_EXPIRED", "/settings/membership"],
      ["SAFETY_NOTICE", "/settings/safety"],
      ["ACCOUNT_NOTICE", "/settings"],
    ]);
  });

  it("a deleted Community post leaves the row without a destination", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const them = await createUser(db, { now: T0 });
    const p = await post(me.userId);
    const row = await notify(me.userId, "COMMUNITY_COMMENT", { actorId: them.userId, postId: p.id });
    await db.communityPost.update({ where: { id: p.id }, data: { deletedAt: T0 } });

    const feed = await getNotificationFeed(me, {}, deps);
    expect(feed.items[0]!.href).toBeNull();
    // It still exists and can still be read — a dead link is not a dead row.
    expect(await markNotificationRead(me, row.id, { db, now: T0 })).toEqual({ changed: true, unread: 0 });
  });

  it("a match whose conversation is gone still leads somewhere useful", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await notify(me.userId, "NEW_MATCH");
    expect((await getNotificationFeed(me, {}, deps)).items[0]!.href).toBe("/likes");
  });
});

describe("ordering and paging", () => {
  it("returns the newest first and pages without dropping a row", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    for (let i = 0; i < 12; i += 1) await notify(me.userId, "ACCOUNT_NOTICE", { createdAt: at(T0, -minutes(i)) });

    const first = await getNotificationFeed(me, { limit: 5 }, deps);
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();
    const second = await getNotificationFeed(me, { limit: 5, cursor: first.nextCursor }, deps);
    const third = await getNotificationFeed(me, { limit: 5, cursor: second.nextCursor }, deps);

    const ids = [...first.items, ...second.items, ...third.items].map((n) => n.id);
    expect(new Set(ids).size).toBe(12);
    expect(third.nextCursor).toBeNull();
    const times = [...first.items, ...second.items, ...third.items].map((n) => n.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("does not skip a row when two share a timestamp across a page boundary", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    for (let i = 0; i < 4; i += 1) await notify(me.userId, "ACCOUNT_NOTICE", { createdAt: T0 });

    const first = await getNotificationFeed(me, { limit: 2 }, deps);
    const second = await getNotificationFeed(me, { limit: 2, cursor: first.nextCursor }, deps);
    expect(new Set([...first.items, ...second.items].map((n) => n.id)).size).toBe(4);
  });

  it("a malformed cursor is ignored rather than trusted", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await notify(me.userId, "ACCOUNT_NOTICE");
    for (const cursor of ["", "nonsense", "not-a-date|abc", "|abc", `${T0.toISOString()}|`]) {
      const feed = await getNotificationFeed(me, { limit: 5, cursor }, deps);
      expect(feed.items).toHaveLength(1);
    }
  });

  it("caps the page size a caller can ask for", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    for (let i = 0; i < NOTIFICATION_FEED.maxPageSize + 5; i += 1) {
      await notify(me.userId, "ACCOUNT_NOTICE", { createdAt: at(T0, -minutes(i)) });
    }
    const feed = await getNotificationFeed(me, { limit: 500 }, deps);
    expect(feed.items).toHaveLength(NOTIFICATION_FEED.maxPageSize);
  });
});

describe("row content", () => {
  it("carries the payload's own context and nothing invented", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await notify(me.userId, "PAYMENT_REJECTED", { data: { reason: "Reference did not match" }, createdAt: T0 });
    await notify(me.userId, "VERIFICATION_UPDATE", { data: { status: "VERIFIED" }, createdAt: at(T0, -minutes(1)) });
    await notify(me.userId, "SUBSCRIPTION_EXPIRING", { createdAt: at(T0, -minutes(2)) });

    const feed = await getNotificationFeed(me, { limit: 10 }, deps);
    expect(feed.items.map((n) => [n.title, n.detail, n.icon])).toEqual([
      ["Payment not accepted", "Reference did not match", "billing"],
      ["You're photo verified", "Your badge is live on your profile", "verification"],
      ["Your Plus is ending soon", "Renew to keep your Plus features", "billing"],
    ]);
  });
});

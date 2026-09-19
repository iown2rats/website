import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MESSAGE_LIMITS, MESSAGE_SPAM_CEILING } from "@/config/product";
import { InvalidStateError, MessageRateLimitError, NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { getConversationHeader, listConversations } from "@/server/conversations/list";
import { countUnreadConversations, listMessages, markConversationRead, pollConversation, sendMessage } from "@/server/conversations/messages";
import { getMatchProfile } from "@/server/conversations/profile";
import { unmatchConversation } from "@/server/conversations/unmatch";
import { likeUser } from "@/server/likes/like";
import { getNavBadges } from "@/server/notifications/badges";
import { setInvisibleMode } from "@/server/privacy/invisible-mode";
import { blockUser } from "@/server/safety/block";
import { reportConversationPartner } from "@/server/safety/report";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createLocation, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const deps = (now = T0) => ({ db, storage, now });

async function match(a: TestUser, b: TestUser, now = T0): Promise<string> {
  await likeUser(a, b.userId, { db, now });
  const r = await likeUser(b, a.userId, { db, now });
  if (!r.matched || !r.conversationId) throw new Error("expected a match");
  return r.conversationId;
}

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("conversation list and header DTOs", () => {
  it("splits new matches from conversations, orders by activity and counts unread from read state; payload is safe", async () => {
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const me = await createUser(db, { now: T0, name: "Ismail" });
    const a = await createUser(db, { now: T0, name: "Aishath", verified: true, locationId: male.id });
    const b = await createUser(db, { now: T0, name: "Ibrahim" });
    await grantPlus(db, b.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const c = await createUser(db, { now: T0, name: "Nashfa" });
    const convA = await match(me, a, T0);
    const convB = await match(me, b, at(T0, 1000));
    await match(me, c, at(T0, 2000)); // never messaged → new match
    await sendMessage(a, convA, "Hey! Saw you dive too", { db, now: at(T0, minutes(1)) });
    await sendMessage(b, convB, "Free next weekend?", { db, now: at(T0, minutes(2)) });
    await sendMessage(b, convB, "Fuvahmulah has the best tea shops", { db, now: at(T0, minutes(3)) });

    const list = await listConversations(me, deps(at(T0, minutes(5))));
    expect(list.newMatches.map((m) => m.other.name)).toEqual(["Nashfa"]);
    expect(list.conversations.map((c) => c.other.name)).toEqual(["Ibrahim", "Aishath"]);
    expect(list.conversations[0]).toMatchObject({ unreadCount: 2, lastMessage: { preview: "Fuvahmulah has the best tea shops", fromMe: false } });
    expect(list.conversations[1]).toMatchObject({ unreadCount: 1, other: { verified: true } });
    // Signed photo URLs embed the user-scoped object path by design; strip them before auditing the rest.
    const strip = (items: typeof list.conversations) => items.map((i) => ({ ...i, other: { ...i.other, photo: i.other.photo ? { ...i.other.photo, url: "<url>" } : null } }));
    const json = JSON.stringify({ ...list, conversations: strip(list.conversations), newMatches: strip(list.newMatches) });
    for (const forbidden of [me.userId, a.userId, b.userId, a.phoneE164, "phoneE164", "dateOfBirth", "storageKey", "thumbKey", "test/", "tokenHash", "codeHash", "provider", "subscription", "moderation", "snapshot", "userAId", "senderId"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }

    // Header: public fields, location honoured, unmatch offered.
    const header = await getConversationHeader(me, convA, deps());
    expect(header).toMatchObject({ status: "ACTIVE", canUnmatch: true, other: { name: "Aishath", verified: true, location: "Malé" } });
    await db.privacySettings.update({ where: { userId: a.userId }, data: { hideLocation: true } });
    expect((await getConversationHeader(me, convA, deps())).other.location).toBeNull();
    expect(JSON.stringify(header)).not.toContain(a.userId);
  });

  it("does not reorder conversations on background updates; only a new message moves one up", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0, name: "A" });
    const b = await createUser(db, { now: T0, name: "B" });
    const convA = await match(me, a, T0);
    const convB = await match(me, b, T0);
    await sendMessage(a, convA, "first", { db, now: at(T0, minutes(1)) });
    await sendMessage(b, convB, "second", { db, now: at(T0, minutes(2)) });
    expect((await listConversations(me, deps())).conversations.map((c) => c.other.name)).toEqual(["B", "A"]);
    await markConversationRead(me, convA, { db, now: at(T0, minutes(3)) });
    await db.conversation.update({ where: { id: convA }, data: { updatedAt: at(T0, minutes(4)) } });
    expect((await listConversations(me, deps())).conversations.map((c) => c.other.name)).toEqual(["B", "A"]);
    await sendMessage(me, convA, "reply", { db, now: at(T0, minutes(5)) });
    expect((await listConversations(me, deps())).conversations.map((c) => c.other.name)).toEqual(["A", "B"]);
  });
});

describe("history, polling and read state", () => {
  it("pages history newest-first with a stable cursor, and polls incrementally", async () => {
    const me = await createUser(db, { now: T0 });
    const other = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await grantPlus(db, other.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const conv = await match(me, other, T0);
    for (let i = 0; i < 25; i++) await sendMessage(i % 2 ? me : other, conv, `m${i}`, { db, now: at(T0, (i + 1) * 1000) });

    const first = await listMessages(me, conv, { db, limit: 10, now: T0 });
    expect(first.messages.map((m) => m.body)).toEqual(Array.from({ length: 10 }, (_, i) => `m${24 - i}`));
    expect(first.messages[0]).toMatchObject({ fromMe: false, kind: "TEXT" });
    const second = await listMessages(me, conv, { db, limit: 10, cursor: first.nextCursor!, now: T0 });
    expect(second.messages.map((m) => m.body)).toEqual(Array.from({ length: 10 }, (_, i) => `m${14 - i}`));
    const third = await listMessages(me, conv, { db, limit: 10, cursor: second.nextCursor!, now: T0 });
    expect(third.messages).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    const all = [...first.messages, ...second.messages, ...third.messages].map((m) => m.id);
    expect(new Set(all).size).toBe(25);

    const newest = first.messages[0]!.id;
    expect((await pollConversation(me, conv, { db, afterId: newest, now: T0 })).messages).toEqual([]);
    await sendMessage(other, conv, "m25", { db, now: at(T0, 60_000) });
    await sendMessage(other, conv, "m26", { db, now: at(T0, 61_000) });
    const poll = await pollConversation(me, conv, { db, afterId: newest, now: at(T0, 62_000) });
    expect(poll.messages.map((m) => m.body)).toEqual(["m25", "m26"]);
    expect(poll.status).toBe("ACTIVE");
    expect(JSON.stringify(poll)).not.toContain("senderId");
  });

  it("marks incoming messages read only when the conversation is opened; loading the list does not", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    const convA = await match(me, a, T0);
    const convB = await match(me, b, T0);
    await sendMessage(a, convA, "hi", { db, now: at(T0, 1000) });
    await sendMessage(b, convB, "hello", { db, now: at(T0, 2000) });
    await sendMessage(b, convB, "there", { db, now: at(T0, minutes(10)) });

    expect((await getNavBadges(me, { db })).chats).toBe(2);
    expect(await countUnreadConversations(db, me.userId)).toBe(2);
    await listConversations(me, deps());
    expect((await getNavBadges(me, { db })).chats).toBe(2);

    await markConversationRead(me, convB, { db, now: at(T0, minutes(11)) });
    expect((await getNavBadges(me, { db })).chats).toBe(1);
    const list = await listConversations(me, deps(at(T0, minutes(12))));
    expect(list.conversations.find((c) => c.id === convB)?.unreadCount).toBe(0);
    expect(list.conversations.find((c) => c.id === convA)?.unreadCount).toBe(1);
    expect(await db.notification.count({ where: { userId: me.userId, type: "MESSAGE", readAt: null } })).toBe(1);
    await sendMessage(b, convB, "again", { db, now: at(T0, minutes(20)) });
    expect((await getNavBadges(me, { db })).chats).toBe(2);
  });

  it("the sender is never notified and receives at most one unread notification per conversation", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const conv = await match(me, a, T0);
    await sendMessage(a, conv, "one", { db, now: at(T0, 1000) });
    await sendMessage(a, conv, "two", { db, now: at(T0, 2000) });
    expect(await db.notification.count({ where: { type: "MESSAGE", userId: me.userId } })).toBe(1);
    expect(await db.notification.count({ where: { type: "MESSAGE", userId: a.userId } })).toBe(0);
  });
});

describe("validation and send edge cases", () => {
  it("stores markup as text, rejects empty and oversized messages, strips control characters", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    const conv = await match(me, a, T0);
    const xss = "<img src=x onerror=alert(1)> <b>hi</b>";
    const sent = await sendMessage(me, conv, xss, { db, now: T0 });
    expect(sent.body).toBe(xss); // stored verbatim, rendered as text by React
    await expect(sendMessage(a, conv, "   \n  ", { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(sendMessage(a, conv, "x".repeat(MESSAGE_LIMITS.maxLength + 1), { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    const ctrl = await sendMessage(a, conv, "line one\r\nline two" + String.fromCharCode(7), { db, now: at(T0, 1000) });
    expect(ctrl.body).toBe("line one\nline two");
    expect(await db.message.count({ where: { senderId: a.userId } })).toBe(1);
  });

  it("a rejected send leaves no trace and does not affect the next one", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    const conv = await match(me, a, T0);
    await sendMessage(me, conv, "first", { db, now: T0 });
    await expect(sendMessage(me, conv, "   ", { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    const ok = await sendMessage(me, conv, "second", { db, now: T0 });
    expect(ok.body).toBe("second");
    expect(await db.message.count({ where: { senderId: me.userId, kind: "TEXT" } })).toBe(2);
  });

  it("Plus is still subject to the anti-spam ceiling, which is not an entitlement", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const conv = await match(me, a, T0);
    for (let i = 0; i < MESSAGE_SPAM_CEILING.perMinute; i++) await sendMessage(me, conv, `spam ${i}`, { db, now: at(T0, i * 100) });
    await expect(sendMessage(me, conv, "one more", { db, now: at(T0, 5000) })).rejects.toBeInstanceOf(MessageRateLimitError);
    const later = await sendMessage(me, conv, "next minute", { db, now: at(T0, 61_000) });
    expect(later.body).toBe("next minute");
  });

  it("a Free sender is never gated on tier: consecutive sends succeed with and without Plus", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    const conv = await match(me, a, T0);
    await sendMessage(me, conv, "free one", { db, now: T0 });
    const second = await sendMessage(me, conv, "free two", { db, now: T0 });
    expect(second.body).toBe("free two");
    await grantPlus(db, me.userId, at(T0, minutes(2)), at(T0, hours(24)));
    const third = await sendMessage(me, conv, "plus now", { db, now: at(T0, minutes(2)) });
    expect(third.body).toBe("plus now");
    expect(await db.message.count({ where: { senderId: me.userId, kind: "TEXT" } })).toBe(3);
  });

  it("Invisible Mode has no effect on an existing match's conversation", async () => {
    const ghost = await createUser(db, { now: T0 });
    const me = await createUser(db, { now: T0 });
    const conv = await match(ghost, me, T0);
    await grantPlus(db, ghost.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await setInvisibleMode(ghost, true, { db, now: T0 });
    expect((await listConversations(me, deps())).newMatches.map((m) => m.id)).toContain(conv);
    await sendMessage(me, conv, "still here", { db, now: at(T0, 1000) });
    await sendMessage(ghost, conv, "and here", { db, now: at(T0, 2000) });
    expect((await getMatchProfile(me, conv, deps()))?.handle).toBe(ghost.handle);
  });
});

describe("block, unmatch and report", () => {
  it("a send racing a block never lands after the block; history is preserved", async () => {
    for (let round = 0; round < 5; round++) {
      const me = await createUser(db, { now: T0 });
      const a = await createUser(db, { now: T0 });
      await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
      const conv = await match(me, a, T0);
      await sendMessage(me, conv, "before", { db, now: T0 });
      const results = await Promise.allSettled([
        sendMessage(me, conv, "racing", { db, now: at(T0, 1000) }),
        blockUser(a, me.userId, { db, now: at(T0, 1000) }),
      ]);
      const sent = results[0]!.status === "fulfilled";
      const messages = await db.message.findMany({ where: { conversationId: conv }, orderBy: { createdAt: "asc" } });
      // Either the send serialised before the block (kept, conversation now LOCKED) or it was refused; never both.
      expect(messages.length).toBe(sent ? 2 : 1);
      expect((await db.conversation.findUniqueOrThrow({ where: { id: conv } })).status).toBe("LOCKED");
      await expect(sendMessage(me, conv, "after", { db, now: at(T0, 2000) })).rejects.toBeInstanceOf(NotFoundError);
      await expect(sendMessage(a, conv, "after", { db, now: at(T0, 2000) })).rejects.toBeInstanceOf(NotFoundError);
      expect(await db.message.count({ where: { conversationId: conv } })).toBe(messages.length);
      expect((await listConversations(me, deps())).conversations.map((c) => c.id)).not.toContain(conv);
    }
  });

  it("unmatch ends messaging both ways with soft state and keeps history; the header stops offering unmatch", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    const conv = await match(me, a, T0);
    await sendMessage(me, conv, "hello", { db, now: T0 });
    const result = await unmatchConversation(me, conv, { db, now: at(T0, 1000) });
    const matchRow = await db.match.findUniqueOrThrow({ where: { id: result.matchId! } });
    expect(matchRow).toMatchObject({ status: "UNMATCHED", unmatchedById: me.userId });
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conv } })).status).toBe("LOCKED");
    await expect(sendMessage(a, conv, "wait", { db, now: at(T0, 2000) })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(sendMessage(me, conv, "wait", { db, now: at(T0, 2000) })).rejects.toBeInstanceOf(InvalidStateError);
    expect(await db.message.count({ where: { conversationId: conv } })).toBe(1);
    expect((await listConversations(me, deps())).conversations.map((c) => c.id)).not.toContain(conv);
    expect((await listConversations(a, deps())).conversations.map((c) => c.id)).not.toContain(conv);
    expect((await listMessages(a, conv, { db })).messages).toHaveLength(1);
    expect(await getConversationHeader(me, conv, deps())).toMatchObject({ status: "LOCKED", canUnmatch: false });
    await expect(unmatchConversation(me, conv, { db, now: at(T0, 3000) })).rejects.toBeInstanceOf(InvalidStateError);
    // A stale ACTIVE conversation row with a non-active match still refuses sends.
    await db.conversation.update({ where: { id: conv }, data: { status: "ACTIVE" } });
    await expect(sendMessage(me, conv, "sneak", { db, now: at(T0, 4000) })).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("reporting stores evidence with the approved reason, then blocks; the target is resolved server-side", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    const conv = await match(me, a, T0);
    await sendMessage(a, conv, "send me money", { db, now: T0 });
    const result = await reportConversationPartner(me, { conversationId: conv, reason: "SCAM_OR_FINANCIAL_REQUEST", note: "asked for cash", targetUserId: me.userId }, { db, now: at(T0, 1000) });
    const report = await db.report.findUniqueOrThrow({ where: { id: result.reportId } });
    expect(report).toMatchObject({ reporterId: me.userId, targetUserId: a.userId, reason: "SCAM_OR_FINANCIAL_REQUEST", status: "OPEN", note: "asked for cash" });
    expect(JSON.stringify(report.snapshot)).toContain("send me money");
    expect(await db.block.count({ where: { blockerId: me.userId, blockedId: a.userId, source: "REPORT" } })).toBe(1);
    expect(await db.message.count({ where: { conversationId: conv } })).toBe(1);
    await expect(reportConversationPartner(me, { conversationId: conv, reason: "NOT_A_REASON" }, { db })).rejects.toBeInstanceOf(ValidationError);
    await expect(reportConversationPartner(a, { conversationId: "nope", reason: "SPAM" }, { db })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a non-participant cannot read the header, poll, mark read, unmatch or view the match profile", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    const c = await createUser(db, { now: T0 });
    const conv = await match(me, a, T0);
    await expect(getConversationHeader(c, conv, deps())).rejects.toBeInstanceOf(NotFoundError);
    await expect(pollConversation(c, conv, { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(markConversationRead(c, conv, { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(unmatchConversation(c, conv, { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMatchProfile(c, conv, deps())).rejects.toBeInstanceOf(NotFoundError);
    await expect(getConversationHeader(c, "unknown-id", deps())).rejects.toBeInstanceOf(NotFoundError);
  });
});

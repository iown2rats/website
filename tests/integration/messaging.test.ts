import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MESSAGE_SPAM_CEILING } from "@/config/product";
import { MessageRateLimitError, NotFoundError } from "@/lib/errors";
import { likeUser } from "@/server/likes/like";
import { listMessages, markConversationRead, sendMessage } from "@/server/conversations/messages";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");

async function match(a: TestUser, b: TestUser, now = T0): Promise<string> {
  await likeUser(a, b.userId, { db, now });
  const r = await likeUser(b, a.userId, { db, now });
  if (!r.matched || !r.conversationId) throw new Error("expected a match");
  return r.conversationId;
}

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

/*
 * Messaging a match is free and unlimited on every tier (docs/ARCHITECTURE.md §12.4). These are the tests that
 * hold that rule down: if anyone reintroduces a per-tier wait, a quota or a charge, they fail. "Immediately"
 * here means at the very same timestamp — not "a second later" — because a cooldown of any length would show up.
 */
describe("matched messaging is unlimited on every tier", () => {
  it("a Free user sends five consecutive messages at the same instant", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    for (let i = 0; i < 5; i += 1) {
      const sent = await sendMessage(a, conv, `Free ${i}`, { db, now: T0 });
      expect(sent.body).toBe(`Free ${i}`);
    }
    expect(await db.message.count({ where: { senderId: a.userId } })).toBe(5);
  });

  it("Free ↔ Free: both sides send freely, interleaved, with no wait either way", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    for (let i = 0; i < 4; i += 1) {
      await sendMessage(a, conv, `A${i}`, { db, now: T0 });
      await sendMessage(b, conv, `B${i}`, { db, now: T0 });
    }
    const page = await listMessages(a, conv, { db, limit: 100 });
    expect(page.messages).toHaveLength(8);
  });

  it("Free ↔ Plus: the Free side is not throttled by the other side's tier", async () => {
    const [free, plus] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await grantPlus(db, plus.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const conv = await match(free, plus);
    for (let i = 0; i < 3; i += 1) await sendMessage(free, conv, `free ${i}`, { db, now: T0 });
    for (let i = 0; i < 3; i += 1) await sendMessage(plus, conv, `plus ${i}`, { db, now: T0 });
    expect(await db.message.count({ where: { senderId: free.userId } })).toBe(3);
    expect(await db.message.count({ where: { senderId: plus.userId } })).toBe(3);
  });

  it("Plus ↔ Plus: unlimited, as before", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await grantPlus(db, b.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const conv = await match(a, b);
    for (let i = 0; i < 5; i += 1) await sendMessage(a, conv, `Msg ${i}`, { db, now: T0 });
    expect(await db.message.count({ where: { senderId: a.userId } })).toBe(5);
  });

  it("a Free user messages several matches at the same instant — nothing is global any more", async () => {
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    const c = await createUser(db, { now: T0 });
    const convB = await match(a, b);
    const convC = await match(a, c);
    await sendMessage(a, convB, "Hi B", { db, now: T0 });
    await sendMessage(a, convC, "Hi C", { db, now: T0 });
    expect(await db.message.count({ where: { senderId: a.userId } })).toBe(2);
  });

  it("Plus lapsing mid-conversation does not reintroduce a wait", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, minutes(5)));
    const conv = await match(a, b);
    await sendMessage(a, conv, "While Plus", { db, now: at(T0, minutes(4)) });
    // One minute later the subscription is gone. The next message still goes straight through.
    const afterLapse = await sendMessage(a, conv, "After lapse", { db, now: at(T0, minutes(6)) });
    expect(afterLapse.body).toBe("After lapse");
    const again = await sendMessage(a, conv, "And again", { db, now: at(T0, minutes(6)) });
    expect(again.body).toBe("And again");
  });

  it("concurrent sends all commit instead of one winning", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => sendMessage(a, conv, `Race ${i}`, { db, now: at(T0, minutes(1)) })),
    );
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(await db.message.count({ where: { senderId: a.userId } })).toBe(6);
  });

  it("receiving and reading are immediate, and a reply needs no wait", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "One", { db, now: T0 });
    const page = await listMessages(b, conv, { db });
    expect(page.messages.map((m) => m.body)).toEqual(["One"]);
    await markConversationRead(b, conv, { db, now: at(T0, 1000) });
    const participant = await db.conversationParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: conv, userId: b.userId } },
    });
    expect(participant.lastReadMessageId).toBe(page.messages[0]!.id);
    await sendMessage(b, conv, "Two", { db, now: at(T0, 2000) });
    const three = await sendMessage(b, conv, "Three", { db, now: at(T0, 2000) });
    expect(three.body).toBe("Three");
  });
});

/*
 * The one ceiling that remains. It is a SAFETY rule: identical on Free and Plus, and never presented as something
 * an upgrade removes. A normal conversation never approaches it.
 */
describe("anti-spam ceiling (safety, every tier)", () => {
  it("stops a Free sender at the ceiling and applies the same limit to Plus", async () => {
    for (const plus of [false, true]) {
      await resetDb(db);
      const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
      if (plus) await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
      const conv = await match(a, b);
      for (let i = 0; i < MESSAGE_SPAM_CEILING.perMinute; i += 1) {
        await sendMessage(a, conv, `m${i}`, { db, now: T0 });
      }
      await expect(sendMessage(a, conv, "over", { db, now: T0 })).rejects.toBeInstanceOf(MessageRateLimitError);
      expect(await db.message.count({ where: { senderId: a.userId } })).toBe(MESSAGE_SPAM_CEILING.perMinute);
    }
  });

  it("the ceiling is a rolling minute, not a lockout", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    for (let i = 0; i < MESSAGE_SPAM_CEILING.perMinute; i += 1) await sendMessage(a, conv, `m${i}`, { db, now: T0 });
    await expect(sendMessage(a, conv, "over", { db, now: T0 })).rejects.toBeInstanceOf(MessageRateLimitError);
    const later = await sendMessage(a, conv, "a minute later", { db, now: at(T0, minutes(1) + 1000) });
    expect(later.body).toBe("a minute later");
  });
});

describe("Conversation authorization", () => {
  it("a non-participant cannot read or send, and cannot tell the conversation exists", async () => {
    const [a, b, c] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await expect(listMessages(c, conv, { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendMessage(c, conv, "Intruder", { db, now: T0 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(listMessages(c, "does-not-exist", { db })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a blocked pair cannot continue", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await db.block.create({ data: { blockerId: b.userId, blockedId: a.userId } });
    await expect(sendMessage(a, conv, "Still there?", { db, now: T0 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

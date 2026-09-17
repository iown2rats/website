import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MessageCooldownError, NotFoundError } from "@/lib/errors";
import { getMessageAvailability } from "@/server/entitlements";
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

describe("Free messaging cooldown (1 outgoing message per 9 minutes, global)", () => {
  it("a matched free user can send a message", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    const sent = await sendMessage(a, conv, "Hello!", { db, now: T0 });
    expect(sent.body).toBe("Hello!");
    expect(sent.nextAvailableAt.getTime()).toBe(at(T0, minutes(9)).getTime());
  });

  it("an immediate second message is rejected with the exact availability time", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "First", { db, now: T0 });
    const err = await sendMessage(a, conv, "Second", { db, now: at(T0, minutes(2)) }).catch((e) => e);
    expect(err).toBeInstanceOf(MessageCooldownError);
    expect((err as MessageCooldownError).availableAt.getTime()).toBe(at(T0, minutes(9)).getTime());
    const availability = await getMessageAvailability(db, a.userId, at(T0, minutes(2)));
    expect(availability.canSendNow).toBe(false);
    expect(availability.availableAt.getTime()).toBe(at(T0, minutes(9)).getTime());
  });

  it("is allowed again exactly 9 minutes later", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "First", { db, now: T0 });
    await expect(sendMessage(a, conv, "Too soon", { db, now: at(T0, minutes(9) - 1) })).rejects.toBeInstanceOf(MessageCooldownError);
    const ok = await sendMessage(a, conv, "On time", { db, now: at(T0, minutes(9)) });
    expect(ok.body).toBe("On time");
  });

  it("applies across conversations, not per conversation", async () => {
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    const c = await createUser(db, { now: T0 });
    const convB = await match(a, b);
    const convC = await match(a, c);
    await sendMessage(a, convB, "Hi B", { db, now: T0 });
    await expect(sendMessage(a, convC, "Hi C", { db, now: at(T0, minutes(1)) })).rejects.toBeInstanceOf(MessageCooldownError);
  });

  it("never delays receiving or reading", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "One", { db, now: T0 });
    // b, also Free and also inside their own (empty) cooldown state, receives and reads instantly.
    const page = await listMessages(b, conv, { db });
    expect(page.messages.map((m) => m.body)).toEqual(["One"]);
    await markConversationRead(b, conv, { db, now: at(T0, 1000) });
    const participant = await db.conversationParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: conv, userId: b.userId } },
    });
    expect(participant.lastReadMessageId).toBe(page.messages[0]!.id);
    // b can reply immediately; their own cooldown starts only with their own first message.
    const reply = await sendMessage(b, conv, "Two", { db, now: at(T0, 2000) });
    expect(reply.body).toBe("Two");
    await expect(sendMessage(b, conv, "Three", { db, now: at(T0, 3000) })).rejects.toBeInstanceOf(MessageCooldownError);
  });

  it("a direct call during the cooldown is rejected by the server regardless of UI state", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "First", { db, now: T0 });
    // Simulates a client that ignores the disabled Send button and calls the action repeatedly.
    for (let i = 0; i < 3; i++) {
      await expect(sendMessage(a, conv, `Bypass ${i}`, { db, now: at(T0, minutes(4)) })).rejects.toBeInstanceOf(MessageCooldownError);
    }
    expect(await db.message.count({ where: { senderId: a.userId } })).toBe(1);
  });

  it("simultaneous sends yield exactly one message", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => sendMessage(a, conv, `Race ${i}`, { db, now: at(T0, minutes(1)) })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
    expect(await db.message.count({ where: { senderId: a.userId } })).toBe(1);
  });
});

describe("Plus messaging", () => {
  it("has no cooldown", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const conv = await match(a, b);
    for (let i = 0; i < 5; i++) await sendMessage(a, conv, `Msg ${i}`, { db, now: at(T0, i * 1000) });
    expect(await db.message.count({ where: { senderId: a.userId } })).toBe(5);
    expect((await getMessageAvailability(db, a.userId, T0)).canSendNow).toBe(true);
  });

  it("returns to the Free cooldown when Plus lapses, measured from the last message", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, minutes(5)));
    const conv = await match(a, b);
    await sendMessage(a, conv, "While Plus", { db, now: at(T0, minutes(4)) });
    await expect(sendMessage(a, conv, "After lapse", { db, now: at(T0, minutes(6)) })).rejects.toBeInstanceOf(MessageCooldownError);
    const ok = await sendMessage(a, conv, "Cooled", { db, now: at(T0, minutes(13)) });
    expect(ok.body).toBe("Cooled");
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

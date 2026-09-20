import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getConversationReadState, markConversationRead, pollConversation, sendMessage } from "@/server/conversations/messages";
import { likeUser } from "@/server/likes/like";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, minutes, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-20T09:00:00Z");

async function match(a: TestUser, b: TestUser, now = T0): Promise<string> {
  await likeUser(a, b.userId, { db, now });
  const r = await likeUser(b, a.userId, { db, now });
  if (!r.matched || !r.conversationId) throw new Error("expected a match");
  return r.conversationId;
}

const setReceipts = (user: TestUser, on: boolean) =>
  db.privacySettings.upsert({ where: { userId: user.userId }, create: { userId: user.userId, readReceipts: on }, update: { readReceipts: on } });

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

/*
 * Read receipts (docs/ARCHITECTURE.md §12.12). Both fields existed in the schema from the start and were wired to
 * nothing, so these tests exist to keep the wire attached — and, more importantly, to hold the symmetry down. A
 * receipt you receive but never give is not a privacy setting, it is an advantage, and it would be an easy thing
 * to "simplify" away later.
 */
describe("read receipts", () => {
  it("does not report a read before the other person has opened the chat", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    const state = await getConversationReadState(db, a.userId, conv, b.userId);
    expect(state.otherReadAt).toBeNull();
  });

  it("reports the read once the other person opens the chat", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    const readAt = at(T0, minutes(1));
    await markConversationRead(b, conv, { db, now: readAt });
    const state = await getConversationReadState(db, a.userId, conv, b.userId);
    expect(state.otherReadAt).toBe(readAt.toISOString());
  });

  it("hides the receipt when the READER has turned receipts off", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    await setReceipts(b, false);
    await markConversationRead(b, conv, { db, now: at(T0, minutes(1)) });
    const state = await getConversationReadState(db, a.userId, conv, b.userId);
    expect(state.otherReadAt).toBeNull();
  });

  it("hides the receipt from a VIEWER who has turned receipts off — the setting is reciprocal", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    await markConversationRead(b, conv, { db, now: at(T0, minutes(1)) }); // b reads, and b allows receipts
    await setReceipts(a, false); // ...but a does not give them
    const state = await getConversationReadState(db, a.userId, conv, b.userId);
    expect(state.otherReadAt).toBeNull();
  });

  it("carries the read state on every poll, so Seen appears without a new message", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    const sent = await sendMessage(a, conv, "hello", { db, now: T0 });
    const before = await pollConversation(a, conv, { afterId: sent.id, db, now: at(T0, minutes(1)) });
    expect(before.messages).toHaveLength(0);
    expect(before.readState.otherReadAt).toBeNull();

    await markConversationRead(b, conv, { db, now: at(T0, minutes(2)) });
    const after = await pollConversation(a, conv, { afterId: sent.id, db, now: at(T0, minutes(3)) });
    expect(after.messages).toHaveLength(0);
    expect(after.readState.otherReadAt).toBe(at(T0, minutes(2)).toISOString());
  });

  it("defaults to on when an account has no privacy row at all", async () => {
    // Accounts predating the settings row, and anyone whose row is missing for any reason, must still get
    // receipts: the column default is true, so absence has to read as "on" rather than silently disabling it.
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    await markConversationRead(b, conv, { db, now: at(T0, minutes(1)) });
    await db.privacySettings.deleteMany({ where: { userId: { in: [a.userId, b.userId] } } });
    const state = await getConversationReadState(db, a.userId, conv, b.userId);
    expect(state.otherReadAt).toBe(at(T0, minutes(1)).toISOString());
  });
});

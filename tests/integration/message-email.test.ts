import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MESSAGE_EMAIL } from "@/config/product";
import type { ConsoleEmailProvider } from "@/lib/email";
import { getEmailProvider, resetEmailProviderCache } from "@/lib/email";
import { markConversationRead, sendMessage } from "@/server/conversations/messages";
import { likeUser } from "@/server/likes/like";
import { notifyAwayRecipient, sweepUnreadMessageEmails } from "@/server/notifications/message-email";
import { PRESENCE } from "@/config/product";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createIdentity, createUser, minutes, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-20T09:00:00Z");
/** Past the delay, so a sweep at this moment is entitled to send. */
const LATER = at(T0, MESSAGE_EMAIL.unreadForMs + minutes(1));

async function match(a: TestUser, b: TestUser, now = T0): Promise<string> {
  await likeUser(a, b.userId, { db, now });
  const r = await likeUser(b, a.userId, { db, now });
  if (!r.matched || !r.conversationId) throw new Error("expected a match");
  return r.conversationId;
}

function mailbox(): ConsoleEmailProvider {
  return getEmailProvider() as ConsoleEmailProvider;
}

beforeEach(async () => {
  await resetDb(db);
  resetEmailProviderCache();
});

/** Nobody is emailed while they are in the app, so a test about email has to put them outside it first. */
const goAway = (user: TestUser, now = T0) =>
  db.user.update({ where: { id: user.userId }, data: { lastActiveAt: new Date(now.getTime() - PRESENCE.activeWithinMs - 60_000) } });

const beHere = (user: TestUser, now = T0) => db.user.update({ where: { id: user.userId }, data: { lastActiveAt: now } });
afterAll(() => disconnectDb());

/*
 * "Someone messaged you while you were away" (docs/ARCHITECTURE.md §12.13).
 *
 * The trigger is "still unread after a delay", never a guess at whether somebody is online, so the tests are
 * mostly about restraint: the cases where an email must NOT go outnumber the case where it must.
 */
describe("unread message email", () => {
  it("sends nothing while the message is younger than the delay", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    const result = await sweepUnreadMessageEmails({ db, now: at(T0, minutes(1)), force: true });
    expect(result.sent).toBe(0);
    expect(mailbox().sent).toHaveLength(0);
  });

  it("sends once the message has gone unread past the delay", async () => {
    const [a, b] = [await createUser(db, { now: T0, name: "Aminath" }), await createUser(db, { now: T0 })];
    const { email } = await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    const result = await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    expect(result.sent).toBe(1);
    const [sent] = mailbox().sent;
    expect(sent!.to).toBe(email);
    expect(sent!.subject).toContain("Aminath");
  });

  it("never puts the message itself in the email", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "meet me at the jetty at nine", { db, now: T0 });

    await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    const [sent] = mailbox().sent;
    expect(sent!.text).not.toContain("jetty");
    expect(sent!.html).not.toContain("jetty");
  });

  it("sends nothing when the recipient opened the chat in the meantime", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    await markConversationRead(b, conv, { db, now: at(T0, minutes(2)) });

    const result = await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    expect(result.sent).toBe(0);
    expect(mailbox().sent).toHaveLength(0);
  });

  it("sends one email for a burst, not one per message", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    for (let i = 0; i < 12; i += 1) await sendMessage(a, conv, `msg ${i}`, { db, now: T0 });

    const first = await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    expect(first.sent).toBe(1);
    // Still unread, and swept again well inside the cooldown: the second one must be held.
    const second = await sweepUnreadMessageEmails({ db, now: at(LATER, minutes(5)), force: true });
    expect(second.sent).toBe(0);
    expect(mailbox().sent).toHaveLength(1);
  });

  it("respects the recipient's message notification setting", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await goAway(b);
    await db.notificationSettings.upsert({
      where: { userId: b.userId },
      create: { userId: b.userId, messages: false },
      update: { messages: false },
    });
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    const result = await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    expect(result.sent).toBe(0);
  });

  it("sends nothing to an account with no email address", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const conv = await match(a, b); // b has no AuthIdentity, so no address
    await sendMessage(a, conv, "hello", { db, now: T0 });

    const result = await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("sends nothing to a suspended account", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    await db.user.update({ where: { id: b.userId }, data: { status: "SUSPENDED" } });

    const result = await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    expect(result.sent).toBe(0);
  });

  it("gives up on a message old enough that an email would be worse than silence", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    const muchLater = at(T0, MESSAGE_EMAIL.giveUpAfterMs + minutes(60));
    const result = await sweepUnreadMessageEmails({ db, now: muchLater, force: true });
    expect(result.sent).toBe(0);
  });

  it("does real work at most once a minute when driven by ordinary traffic", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    const first = await sweepUnreadMessageEmails({ db, now: LATER });
    expect(first.throttled).toBe(false);
    const second = await sweepUnreadMessageEmails({ db, now: at(LATER, 1_000) });
    expect(second.throttled).toBe(true);
    expect(second.sent).toBe(0);
  });
});

/*
 * Presence (docs/ARCHITECTURE.md §12.17). The rule the owner asked for is simple to say and easy to get subtly
 * wrong: email the moment somebody is away, and never while they are in the app.
 */
describe("presence decides", () => {
  it("emails immediately when the recipient is not in the app", async () => {
    const [a, b] = [await createUser(db, { now: T0, name: "Aminath" }), await createUser(db, { now: T0 })];
    const { email } = await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    // No delay: the message was sent this instant and the email is owed this instant.
    const outcome = await notifyAwayRecipient({ recipientId: b.userId, conversationId: conv }, { db, now: T0 });
    expect(outcome).toBe("sent");
    expect(mailbox().sent[0]!.to).toBe(email);
  });

  it("sends nothing while the recipient is using the app", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await beHere(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    const outcome = await notifyAwayRecipient({ recipientId: b.userId, conversationId: conv }, { db, now: T0 });
    expect(outcome).toBe("present");
    expect(mailbox().sent).toHaveLength(0);
  });

  it("treats a recipient last seen just outside the window as away", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await db.user.update({ where: { id: b.userId }, data: { lastActiveAt: new Date(T0.getTime() - PRESENCE.activeWithinMs - 1_000) } });
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    expect(await notifyAwayRecipient({ recipientId: b.userId, conversationId: conv }, { db, now: T0 })).toBe("sent");
  });

  it("treats a recipient last seen just inside the window as present", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await db.user.update({ where: { id: b.userId }, data: { lastActiveAt: new Date(T0.getTime() - PRESENCE.activeWithinMs + 1_000) } });
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    expect(await notifyAwayRecipient({ recipientId: b.userId, conversationId: conv }, { db, now: T0 })).toBe("present");
  });

  it("the safety net still refuses to mail someone who came back and is reading", async () => {
    // Present at send time, so no immediate mail. Still present later, so the sweep must hold too — even though
    // the message is old and unread, which is exactly the condition the sweep was built to act on.
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    await beHere(b, LATER);

    const result = await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    expect(result.sent).toBe(0);
    expect(mailbox().sent).toHaveLength(0);
  });

  it("the safety net catches someone who was present at send time and then left", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await beHere(b, T0);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    expect(await notifyAwayRecipient({ recipientId: b.userId, conversationId: conv }, { db, now: T0 })).toBe("present");

    // They never came back and never read it.
    const result = await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    expect(result.sent).toBe(1);
  });

  it("does not email twice when the send path already did", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await createIdentity(db, b.userId);
    await goAway(b);
    const conv = await match(a, b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    expect(await notifyAwayRecipient({ recipientId: b.userId, conversationId: conv }, { db, now: T0 })).toBe("sent");

    const result = await sweepUnreadMessageEmails({ db, now: LATER, force: true });
    expect(result.sent).toBe(0);
    expect(mailbox().sent).toHaveLength(1);
  });
});

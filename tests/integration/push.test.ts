import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESENCE, PUSH } from "@/config/product";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import type { PushPayload, PushSendResult } from "@/lib/push/transport";
import { addComment } from "@/server/community/comments";
import { createPost } from "@/server/community/posts";
import { setPostReaction } from "@/server/community/reactions";
import { getConversationForActor } from "@/server/conversations/access";
import { markConversationRead, sendMessage } from "@/server/conversations/messages";
import { setMessageReaction } from "@/server/conversations/reactions";
import { likeUser } from "@/server/likes/like";
import { registerPushDevice, unregisterAllPushDevices, getPushState } from "@/server/notifications/devices";
import { pushForRecipient, pushNotification, sweepPushQueue } from "@/server/notifications/push";
import { PUSH_CATEGORY, pushUrlFor } from "@/server/notifications/push-copy";
import { updateNotificationSettings } from "@/server/notifications/settings";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

/*
 * Push notifications (docs/ARCHITECTURE.md §29).
 *
 * Two things are being held down here, and only one of them is "does it work".
 *
 * The first is PRIVACY. A push leaves our servers and is drawn on a lock screen anyone standing nearby can read.
 * Every test that sends a message sends one full of distinctive words, and the regression at the bottom asserts
 * that not one of those words reaches a payload — not in the title, not in the body, not in any field, in any
 * notification, ever. That test is the reason this file exists.
 *
 * The second is that nothing here is decided by the client. Presence comes from persisted `lastActiveAt`, "are
 * they reading this chat" comes from the persisted read pointer, and duplicate protection is a unique constraint
 * rather than a count — so a tab that closed without saying so, a retried job and a replayed request all produce
 * exactly the behaviour the member would expect.
 */

const transport = vi.hoisted(() => {
  /*
   * Set before any module is imported, so the very first getEnv() already sees push as configured. These are
   * placeholders, never keys: sendWebPush is replaced below, so nothing is ever signed or sent anywhere. The
   * suite must not be able to reach a real push service even by accident.
   */
  process.env.VAPID_PUBLIC_KEY = "test-vapid-public-key-not-a-real-key";
  process.env.VAPID_PRIVATE_KEY = "test-vapid-private-key-not-a-real-key";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  return {
    sent: [] as { endpoint: string; payload: PushPayload }[],
    outcomes: new Map<string, PushSendResult>(),
  };
});

vi.mock("@/lib/push/transport", () => ({
  sendWebPush: async (target: { endpoint: string }, payload: PushPayload): Promise<PushSendResult> => {
    transport.sent.push({ endpoint: target.endpoint, payload });
    return transport.outcomes.get(target.endpoint) ?? { outcome: "sent" };
  },
  vapidPublicKey: () => process.env.VAPID_PUBLIC_KEY ?? null,
}));

const db = testDb();
const T0 = new Date("2026-09-20T10:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const deps = (now = T0) => ({ db, storage, now });

beforeEach(async () => {
  await resetDb(db);
  transport.sent.length = 0;
  transport.outcomes.clear();
});
afterAll(async () => {
  /*
   * `process.env` belongs to the worker process, not to this file, and a worker runs several files in turn. Left
   * set, these would switch push on for every suite that happened to run afterwards.
   */
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  await disconnectDb();
});

/** Nothing is pushed to somebody who is in the app, so every test about push has to put them outside it first. */
const goAway = (user: TestUser, now = T0) =>
  db.user.update({ where: { id: user.userId }, data: { lastActiveAt: new Date(now.getTime() - PRESENCE.activeWithinMs - 60_000) } });

const beHere = (user: TestUser, now = T0) => db.user.update({ where: { id: user.userId }, data: { lastActiveAt: now } });

/** Turns push on for a member, with whichever categories a test needs. Everything starts false in the database. */
const enablePush = (user: TestUser, categories: Record<string, boolean> = { pushMessages: true }) =>
  db.notificationSettings.upsert({
    where: { userId: user.userId },
    create: { userId: user.userId, push: true, ...categories },
    update: { push: true, ...categories },
  });

/** Registers one browser. The endpoint is what identifies a device everywhere, so tests name theirs. */
const addDevice = (user: TestUser, name: string, now = T0) =>
  registerPushDevice(user, { endpoint: `https://push.example.com/${name}`, keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` } }, { db, now });

/** Community notifications are off by default (NotificationSettings.community defaults to false). */
const wantsCommunity = (user: TestUser) =>
  db.notificationSettings.update({ where: { userId: user.userId }, data: { community: true } });

/*
 * A matched pair with an open conversation.
 *
 * Matching raises notifications of its own — a LIKE_RECEIVED on the way in and a NEW_MATCH for each of them — and
 * those are cleared here. They are real and they are tested in their own section below; leaving them lying around
 * would mean every assertion about a message push was really an assertion about three unrelated notifications
 * that happened to be created first.
 */
async function matched(now = T0): Promise<{ a: TestUser; b: TestUser; conv: string }> {
  const a = await createUser(db, { now, name: "Aminath" });
  const b = await createUser(db, { now, name: "Hind" });
  await likeUser(a, b.userId, { db, now });
  const r = await likeUser(b, a.userId, { db, now });
  if (!r.matched || !r.conversationId) throw new Error("expected a match");
  await db.notification.deleteMany({ where: { type: { in: ["NEW_MATCH", "LIKE_RECEIVED"] } } });
  return { a, b, conv: r.conversationId };
}

/** Every field of every payload sent so far, as one string. What a lock screen and a push service could see. */
const everythingSent = () => JSON.stringify(transport.sent);

// ───────────────────────── Messages ─────────────────────────

describe("a message pushes when the recipient is away", () => {
  it("sends one push naming the sender and pointing at the chat", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);

    await sendMessage(a, conv, "are you coming tonight", { db, now: T0 });
    const outcomes = await pushForRecipient(b.userId, { db, now: T0 });

    expect(outcomes).toEqual(["sent"]);
    expect(transport.sent).toHaveLength(1);
    const [push] = transport.sent;
    expect(push!.payload.title).toBe("Aminath left you a message 💬");
    expect(push!.payload.body).toBe("Open MelloCrush to see it");
    expect(push!.payload.url).toBe(`/chats/${conv}`);
  });

  it("says 'left you a message', never 'sent you a message'", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);

    await sendMessage(a, conv, "hello", { db, now: T0 });
    await pushForRecipient(b.userId, { db, now: T0 });

    expect(transport.sent[0]!.payload.title).toContain("left you a message");
    expect(everythingSent()).not.toContain("sent you a message");
  });

  it("sends nothing while the recipient is using the app", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await beHere(b);

    await sendMessage(a, conv, "hello", { db, now: T0 });

    expect(await pushForRecipient(b.userId, { db, now: T0 })).toEqual(["present"]);
    expect(transport.sent).toHaveLength(0);
  });

  it("does not push about a conversation the recipient has already read", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);

    await sendMessage(a, conv, "hello", { db, now: T0 });
    const notification = await db.notification.findFirstOrThrow({ where: { userId: b.userId, type: "MESSAGE" } });
    // They were in that chat when it arrived: the persisted read pointer moved past the notification.
    await markConversationRead(b, conv, { db, now: at(T0, 1000) });

    // Asked directly, because a read notification is not even a candidate — belt and braces, both holding.
    expect(await pushNotification(db, notification.id, at(T0, 2000))).toBe("already-read");
    expect(await pushForRecipient(b.userId, { db, now: at(T0, 2000) })).toEqual([]);
    expect(transport.sent).toHaveLength(0);
  });

  it("still pushes when a different conversation is the one being read", async () => {
    const { a, b, conv } = await matched();
    const c = await createUser(db, { now: T0, name: "Mariyam" });
    await likeUser(c, b.userId, { db, now: T0 });
    const other = await likeUser(b, c.userId, { db, now: T0 });
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);

    await sendMessage(a, conv, "hello", { db, now: T0 });
    await markConversationRead(b, other.conversationId!, { db, now: at(T0, 1000) });

    expect(await pushForRecipient(b.userId, { db, now: at(T0, 2000) })).toContain("sent");
    expect(transport.sent.map((s) => s.payload.url)).toContain(`/chats/${conv}`);
  });

  it("does not push a notification that has gone stale", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    const notification = await db.notification.findFirstOrThrow({ where: { userId: b.userId, type: "MESSAGE" } });
    expect(await pushNotification(db, notification.id, at(T0, PUSH.freshForMs + minutes(1)))).toBe("stale");
    expect(transport.sent).toHaveLength(0);
  });
});

// ───────────────────────── Who may be named ─────────────────────────

describe("naming the other person", () => {
  it("names nobody when the two have blocked each other", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    await db.block.create({ data: { blockerId: b.userId, blockedId: a.userId, createdAt: at(T0, 500) } });

    await pushForRecipient(b.userId, { db, now: at(T0, 1000) });

    expect(transport.sent[0]!.payload.title).toBe("New message 💬");
    expect(everythingSent()).not.toContain("Aminath");
  });

  it("names nobody when the sender's account is no longer active", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    await db.user.update({ where: { id: a.userId }, data: { status: "SUSPENDED" } });

    await pushForRecipient(b.userId, { db, now: at(T0, 1000) });

    expect(transport.sent[0]!.payload.title).toBe("New message 💬");
    expect(everythingSent()).not.toContain("Aminath");
  });

  it("never names a liker, not even for a Plus member who can see them in the app", async () => {
    const liker = await createUser(db, { now: T0, name: "Shifa" });
    const target = await createUser(db, { now: T0 });
    await grantPlus(db, target.userId, T0, at(T0, hours(24)));
    await enablePush(target, { pushLikes: true });
    await addDevice(target, "phone");
    await goAway(target);

    await likeUser(liker, target.userId, { db, now: T0 });
    await pushForRecipient(target.userId, { db, now: T0 });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.payload.title).toBe("Someone likes you ❤️");
    expect(transport.sent[0]!.payload.body).toBe("Open MelloCrush to find out who");
    expect(everythingSent()).not.toContain("Shifa");
  });
});

// ───────────────────────── The other event kinds ─────────────────────────

describe("likes, matches, reactions and community", () => {
  it("pushes a like without saying who", async () => {
    const liker = await createUser(db, { now: T0, name: "Shifa" });
    const target = await createUser(db, { now: T0 });
    await enablePush(target, { pushLikes: true });
    await addDevice(target, "phone");
    await goAway(target);

    await likeUser(liker, target.userId, { db, now: T0 });

    expect(await pushForRecipient(target.userId, { db, now: T0 })).toEqual(["sent"]);
    expect(transport.sent[0]!.payload.url).toBe("/likes");
  });

  it("pushes a match to both people, pointing each at the new chat", async () => {
    const a = await createUser(db, { now: T0, name: "Aminath" });
    const b = await createUser(db, { now: T0, name: "Hind" });
    for (const u of [a, b]) {
      await enablePush(u, { pushMatches: true });
      await addDevice(u, `device-${u.handle}`);
      await goAway(u);
    }

    await likeUser(a, b.userId, { db, now: T0 });
    const r = await likeUser(b, a.userId, { db, now: T0 });

    await pushForRecipient(a.userId, { db, now: T0 });
    await pushForRecipient(b.userId, { db, now: T0 });

    expect(transport.sent).toHaveLength(2);
    for (const push of transport.sent) {
      expect(push.payload.title).toBe("It's a match! ✨");
      expect(push.payload.url).toBe(`/chats/${r.conversationId}`);
    }
  });

  it("pushes a reaction to a message without repeating the message", async () => {
    const { a, b, conv } = await matched();
    await enablePush(a, { pushReactions: true });
    await addDevice(a, "phone");

    const message = await sendMessage(a, conv, "kayak at the sandbank", { db, now: T0 });
    await goAway(a, at(T0, 1000));
    await setMessageReaction(b, message.id, "LAUGH", { db, now: at(T0, 1000) });

    expect(await pushForRecipient(a.userId, { db, now: at(T0, 1000) })).toEqual(["sent"]);
    expect(transport.sent[0]!.payload.title).toBe("Hind reacted to your message");
    expect(transport.sent[0]!.payload.url).toBe(`/chats/${conv}`);
    expect(everythingSent()).not.toContain("kayak");
  });

  it("pushes a community comment without repeating the comment", async () => {
    const author = await createUser(db, { now: T0 });
    const other = await createUser(db, { now: T0, name: "Ibrahim" });
    await wantsCommunity(author);
    await enablePush(author, { pushCommunity: true });
    await addDevice(author, "phone");

    const post = await createPost(author, { kind: "TEXT", body: "best bodu beru" }, deps());
    await goAway(author, at(T0, 1000));
    await addComment(other, post.id, "the one by the harbour obviously", deps(at(T0, 1000)));

    expect(await pushForRecipient(author.userId, { db, now: at(T0, 1000) })).toEqual(["sent"]);
    expect(transport.sent[0]!.payload.title).toBe("Ibrahim commented on your post");
    expect(transport.sent[0]!.payload.url).toBe(`/community/${post.id}`);
    expect(everythingSent()).not.toContain("harbour");
  });

  it("pushes a reaction on a post under the reactions preference, not the community one", async () => {
    const author = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0, name: "Ibrahim" });
    await wantsCommunity(author);
    // Community activity is off; reactions are on. A post reaction is a reaction.
    await enablePush(author, { pushReactions: true, pushCommunity: false });
    await addDevice(author, "phone");

    const post = await createPost(author, { kind: "TEXT", body: "best bodu beru" }, deps());
    await goAway(author, at(T0, 1000));
    await setPostReaction(fan, post.id, "FIRE", { db, now: at(T0, 1000) });

    expect(await pushForRecipient(author.userId, { db, now: at(T0, 1000) })).toEqual(["sent"]);
    expect(transport.sent[0]!.payload.title).toBe("Ibrahim reacted to your post");
  });

  it("pushes an account notice without disclosing the outcome", async () => {
    const member = await createUser(db, { now: T0 });
    await enablePush(member, { pushAccount: true });
    await addDevice(member, "phone");
    await goAway(member);
    await db.notification.create({
      data: { userId: member.userId, type: "VERIFICATION_UPDATE", data: { status: "REJECTED", reason: "face not visible" }, createdAt: T0 },
    });

    expect(await pushForRecipient(member.userId, { db, now: T0 })).toEqual(["sent"]);
    expect(transport.sent[0]!.payload.title).toBe("Photo verification update");
    expect(transport.sent[0]!.payload.url).toBe("/settings/verification");
    expect(everythingSent()).not.toContain("REJECTED");
    expect(everythingSent()).not.toContain("face not visible");
  });
});

// ───────────────────────── Not to yourself ─────────────────────────

describe("your own actions", () => {
  it("never pushes to you for something you did yourself", async () => {
    const { a, conv } = await matched();
    await enablePush(a, { pushMessages: true, pushReactions: true });
    await addDevice(a, "phone");
    await goAway(a);

    const message = await sendMessage(a, conv, "hello", { db, now: T0 });
    await setMessageReaction(a, message.id, "HEART", { db, now: at(T0, 1000) });

    expect(await db.notification.count({ where: { userId: a.userId, type: { in: ["MESSAGE", "MESSAGE_REACTION"] } } })).toBe(0);
    expect(await pushForRecipient(a.userId, { db, now: at(T0, 1000) })).toEqual([]);
    expect(transport.sent).toHaveLength(0);
  });

  it("never pushes to the author for their own community reaction", async () => {
    const author = await createUser(db, { now: T0 });
    await wantsCommunity(author);
    await enablePush(author, { pushReactions: true });
    await addDevice(author, "phone");
    const post = await createPost(author, { kind: "TEXT", body: "benches" }, deps());
    await goAway(author, at(T0, 1000));

    await setPostReaction(author, post.id, "HEART", { db, now: at(T0, 1000) });

    expect(await pushForRecipient(author.userId, { db, now: at(T0, 1000) })).toEqual([]);
    expect(transport.sent).toHaveLength(0);
  });
});

// ───────────────────────── Preferences ─────────────────────────

describe("preferences", () => {
  it("sends nothing at all until the member turns push on", async () => {
    const { a, b, conv } = await matched();
    // Deliberately no enablePush: a brand new account's push columns are every one of them false.
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    expect(await pushForRecipient(b.userId, { db, now: T0 })).toEqual(["push-off"]);
    expect(transport.sent).toHaveLength(0);
  });

  it("defaults every push preference to off for a new member", async () => {
    const member = await createUser(db, { now: T0 });
    const row = await db.notificationSettings.findUniqueOrThrow({ where: { userId: member.userId } });
    expect({
      push: row.push,
      pushMessages: row.pushMessages,
      pushLikes: row.pushLikes,
      pushMatches: row.pushMatches,
      pushReactions: row.pushReactions,
      pushCommunity: row.pushCommunity,
      pushAccount: row.pushAccount,
    }).toEqual({ push: false, pushMessages: false, pushLikes: false, pushMatches: false, pushReactions: false, pushCommunity: false, pushAccount: false });
  });

  it("honours a category that is switched off while the master switch is on", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b, { pushMessages: false, pushLikes: true });
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    expect(await pushForRecipient(b.userId, { db, now: T0 })).toEqual(["category-off"]);
    expect(transport.sent).toHaveLength(0);
  });

  it("stops everything when the master switch goes off, whatever the categories say", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b, { pushMessages: true, pushLikes: true, pushMatches: true, pushReactions: true, pushCommunity: true, pushAccount: true });
    await addDevice(b, "phone");
    await goAway(b);
    await db.notificationSettings.update({ where: { userId: b.userId }, data: { push: false } });

    await sendMessage(a, conv, "hello", { db, now: T0 });

    expect(await pushForRecipient(b.userId, { db, now: T0 })).toEqual(["push-off"]);
    expect(transport.sent).toHaveLength(0);
  });

  it("leaves the in-app notification feed untouched when push is off", async () => {
    const { a, b, conv } = await matched();
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    // The whole point of the master switch: no push, and the notification is still there to be read in the app.
    expect(await pushForRecipient(b.userId, { db, now: T0 })).toEqual(["push-off"]);
    expect(await db.notification.count({ where: { userId: b.userId, type: "MESSAGE" } })).toBe(1);
  });

  it("turns the three priority categories on with the master switch, and only the first time", async () => {
    const member = await createUser(db, { now: T0 });

    const first = await updateNotificationSettings(member, { push: true }, { db });
    expect({ pushMessages: first.pushMessages, pushLikes: first.pushLikes, pushMatches: first.pushMatches }).toEqual({ pushMessages: true, pushLikes: true, pushMatches: true });
    // Never the quiet ones: reactions, community and account stay off until the member asks for them.
    expect({ pushReactions: first.pushReactions, pushCommunity: first.pushCommunity, pushAccount: first.pushAccount }).toEqual({ pushReactions: false, pushCommunity: false, pushAccount: false });

    await updateNotificationSettings(member, { pushMessages: false }, { db });
    await updateNotificationSettings(member, { push: false }, { db });
    const again = await updateNotificationSettings(member, { push: true }, { db });
    // A member who switched Messages off and push back on gets their own choice back, not our defaults.
    expect(again.pushMessages).toBe(false);
  });
});

// ───────────────────────── Idempotency ─────────────────────────

describe("idempotency", () => {
  it("sends one push however many times the same notification is evaluated", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    const notification = await db.notification.findFirstOrThrow({ where: { userId: b.userId, type: "MESSAGE" } });

    const outcomes = [
      await pushNotification(db, notification.id, T0),
      await pushNotification(db, notification.id, T0),
      await pushNotification(db, notification.id, T0),
    ];

    expect(outcomes).toEqual(["sent", "already-delivered", "already-delivered"]);
    expect(transport.sent).toHaveLength(1);
    expect(await db.pushDelivery.count({ where: { notificationId: notification.id } })).toBe(1);
  });

  it("sends one push when several evaluations race each other", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    const notification = await db.notification.findFirstOrThrow({ where: { userId: b.userId, type: "MESSAGE" } });

    await Promise.all(Array.from({ length: 5 }, () => pushNotification(db, notification.id, T0)));

    expect(transport.sent).toHaveLength(1);
    expect(await db.pushDelivery.count({ where: { notificationId: notification.id } })).toBe(1);
  });

  it("does not re-send when a request and the sweep both run", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    await pushForRecipient(b.userId, { db, now: T0 });
    const swept = await sweepPushQueue({ db, now: at(T0, minutes(1)), force: true });

    expect(swept.sent).toBe(0);
    expect(transport.sent).toHaveLength(1);
  });

  it("retries a delivery that was left PENDING, still as one row", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    const notification = await db.notification.findFirstOrThrow({ where: { userId: b.userId, type: "MESSAGE" } });

    // A process that claimed the pair and then died before recording anything.
    const device = await db.pushSubscription.findFirstOrThrow({ where: { userId: b.userId } });
    await db.pushDelivery.create({ data: { notificationId: notification.id, subscriptionId: device.id, status: "PENDING", attempts: 1, createdAt: T0 } });

    // Too soon: the first process may still be mid-send, so nothing is taken from it.
    expect(await pushNotification(db, notification.id, at(T0, minutes(1)))).toBe("already-delivered");
    expect(transport.sent).toHaveLength(0);

    // Long enough later, the claim is taken over — and it is still the same row.
    const later = at(T0, PUSH.retryStuckAfterMs + minutes(1));
    expect(await pushNotification(db, notification.id, later)).toBe("sent");
    expect(transport.sent).toHaveLength(1);
    expect(await db.pushDelivery.count({ where: { notificationId: notification.id } })).toBe(1);
  });

  it("gives up on a stuck delivery rather than retrying it for ever", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    const notification = await db.notification.findFirstOrThrow({ where: { userId: b.userId, type: "MESSAGE" } });
    const device = await db.pushSubscription.findFirstOrThrow({ where: { userId: b.userId } });
    await db.pushDelivery.create({ data: { notificationId: notification.id, subscriptionId: device.id, status: "PENDING", attempts: PUSH.maxAttempts, createdAt: T0 } });

    expect(await pushNotification(db, notification.id, at(T0, PUSH.retryStuckAfterMs + minutes(1)))).toBe("already-delivered");
    expect(transport.sent).toHaveLength(0);
  });

  it("catches with the sweep what no request pushed", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    // Present when it arrived, so the request-time attempt sent nothing at all.
    await beHere(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    expect(await pushForRecipient(b.userId, { db, now: T0 })).toEqual(["present"]);

    // And then they left without reading it.
    await goAway(b, at(T0, minutes(10)));
    const swept = await sweepPushQueue({ db, now: at(T0, minutes(10)), force: true });

    expect(swept.sent).toBe(1);
    expect(transport.sent).toHaveLength(1);
  });
});

// ───────────────────────── Devices ─────────────────────────

describe("devices", () => {
  it("pushes to every device the member has", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "laptop");
    await addDevice(b, "phone");
    await addDevice(b, "tablet");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });

    expect(await pushForRecipient(b.userId, { db, now: T0 })).toEqual(["sent"]);
    expect(transport.sent.map((s) => s.endpoint).sort()).toEqual([
      "https://push.example.com/laptop",
      "https://push.example.com/phone",
      "https://push.example.com/tablet",
    ]);
    const notification = await db.notification.findFirstOrThrow({ where: { userId: b.userId, type: "MESSAGE" } });
    expect(await db.pushDelivery.count({ where: { notificationId: notification.id } })).toBe(3);
  });

  it("keeps one row for a browser that subscribes again with the same endpoint", async () => {
    const member = await createUser(db, { now: T0 });
    await addDevice(member, "phone");
    await addDevice(member, "phone");
    await addDevice(member, "phone");

    expect(await db.pushSubscription.count({ where: { userId: member.userId } })).toBe(1);
    expect((await getPushState(member, { db })).deviceCount).toBe(1);
  });

  it("disables an endpoint the push service says is gone, and never tries it again", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "dead");
    await addDevice(b, "alive");
    await goAway(b);
    transport.outcomes.set("https://push.example.com/dead", { outcome: "gone", status: 410 });

    await sendMessage(a, conv, "hello", { db, now: T0 });
    await pushForRecipient(b.userId, { db, now: T0 });

    const dead = await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: "https://push.example.com/dead" } });
    expect(dead.disabledAt).not.toBeNull();

    transport.sent.length = 0;
    await sendMessage(a, conv, "again", { db, now: at(T0, minutes(1)) });
    await db.notification.updateMany({ where: { userId: b.userId }, data: { readAt: null } });
    await pushForRecipient(b.userId, { db, now: at(T0, minutes(1)) });

    expect(transport.sent.map((s) => s.endpoint)).not.toContain("https://push.example.com/dead");
  });

  it("disables an endpoint only after repeated transient failures", async () => {
    const member = await createUser(db, { now: T0 });
    await enablePush(member, { pushLikes: true });
    await addDevice(member, "flaky");
    await goAway(member);
    transport.outcomes.set("https://push.example.com/flaky", { outcome: "failed", status: 500, error: "push service responded 500" });

    for (let i = 0; i < PUSH.maxFailures; i += 1) {
      const liker = await createUser(db, { now: T0 });
      await likeUser(liker, member.userId, { db, now: at(T0, i * 1000) });
      const n = await db.notification.findFirstOrThrow({ where: { userId: member.userId, actorId: liker.userId } });
      expect(await pushNotification(db, n.id, at(T0, i * 1000))).toBe("failed");
    }

    const flaky = await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: "https://push.example.com/flaky" } });
    expect(flaky.failureCount).toBe(0);
    expect(flaky.disabledAt).not.toBeNull();
  });

  it("refuses an endpoint that is not an https URL", async () => {
    const member = await createUser(db, { now: T0 });
    await expect(registerPushDevice(member, { endpoint: "not-a-url", keys: { p256dh: "x", auth: "y" } }, { db })).rejects.toBeInstanceOf(ValidationError);
    await expect(registerPushDevice(member, { endpoint: "http://push.example.com/a", keys: { p256dh: "x", auth: "y" } }, { db })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("cannot forget somebody else's device", async () => {
    const mine = await createUser(db, { now: T0 });
    const theirs = await createUser(db, { now: T0 });
    await addDevice(theirs, "their-phone");

    const { unregisterPushDevice } = await import("@/server/notifications/devices");
    await unregisterPushDevice(mine, "https://push.example.com/their-phone", { db });

    expect(await db.pushSubscription.count({ where: { userId: theirs.userId } })).toBe(1);
  });

  it("stops every device when push is turned off everywhere", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "laptop");
    await addDevice(b, "phone");
    await goAway(b);

    await unregisterAllPushDevices(b, { db });
    await updateNotificationSettings(b, { push: false }, { db });
    await sendMessage(a, conv, "hello", { db, now: T0 });

    expect(await pushForRecipient(b.userId, { db, now: T0 })).toEqual(["push-off"]);
    expect(transport.sent).toHaveLength(0);
    expect(await db.pushSubscription.count({ where: { userId: b.userId } })).toBe(0);
  });
});

// ───────────────────────── Deep links ─────────────────────────

describe("deep links", () => {
  it("points every kind at a path on our own origin", () => {
    for (const kind of Object.keys(PUSH_CATEGORY) as (keyof typeof PUSH_CATEGORY)[]) {
      const url = pushUrlFor({ kind, conversationId: "conv-1", postId: "post-1" });
      expect(url.startsWith("/")).toBe(true);
      // Never an absolute URL, never a scheme, and never anything a service worker would refuse to open.
      expect(url).not.toContain("//");
      expect(url).not.toContain("?");
    }
  });

  it("falls back to the list when the notification carries no target", () => {
    expect(pushUrlFor({ kind: "MESSAGE", conversationId: null })).toBe("/chats");
    expect(pushUrlFor({ kind: "COMMUNITY_COMMENT", postId: null })).toBe("/community");
    expect(pushUrlFor({ kind: "NEW_MATCH", conversationId: null })).toBe("/likes");
  });

  it("sends somebody who follows a link they may not follow to the same NotFound as anyone else", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "hello", { db, now: T0 });
    await pushForRecipient(b.userId, { db, now: T0 });

    const url = transport.sent[0]!.payload.url;
    expect(url).toBe(`/chats/${conv}`);

    // The id in the payload is a route, not a permission: the destination re-authorises on arrival.
    const stranger = await createUser(db, { now: T0 });
    await expect(getConversationForActor(db, stranger, conv)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ───────────────────────── The rule this file exists for ─────────────────────────

describe("message text can never reach a push payload", () => {
  it("carries none of the words of a message, a reply, a comment or a reacted-to message", async () => {
    const secrets = ["pineapple", "sandbank", "aubergine", "flamingo"];

    const { a, b, conv } = await matched();
    await enablePush(b, { pushMessages: true, pushReactions: true, pushCommunity: true, pushLikes: true, pushMatches: true, pushAccount: true });
    await enablePush(a, { pushMessages: true, pushReactions: true, pushCommunity: true });
    await addDevice(b, "b-phone");
    await addDevice(a, "a-phone");
    await wantsCommunity(b);
    await goAway(a);
    await goAway(b);

    const first = await sendMessage(a, conv, `meet me at the ${secrets[0]} stall`, { db, now: T0 });
    await sendMessage(a, conv, `then the ${secrets[1]}`, { db, now: at(T0, 1000), replyToMessageId: first.id });
    await pushForRecipient(b.userId, { db, now: at(T0, 1000) });

    // A reaction on a message whose text is a secret.
    const mine = await sendMessage(a, conv, `bring the ${secrets[2]}`, { db, now: at(T0, 2000) });
    await setMessageReaction(b, mine.id, "LAUGH", { db, now: at(T0, 3000) });
    await pushForRecipient(a.userId, { db, now: at(T0, 3000) });

    // And a comment on a post, which is somebody's words just the same.
    const post = await createPost(b, { kind: "TEXT", body: "where to eat" }, deps(at(T0, 4000)));
    await addComment(a, post.id, `the ${secrets[3]} place`, deps(at(T0, 5000)));
    await pushForRecipient(b.userId, { db, now: at(T0, 5000) });

    expect(transport.sent.length).toBeGreaterThan(0);
    const everything = everythingSent();
    for (const secret of secrets) expect(everything).not.toContain(secret);
  });

  it("puts nothing in a payload but a title, a body, a path and a tag", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    await sendMessage(a, conv, "anything at all", { db, now: T0 });
    await pushForRecipient(b.userId, { db, now: T0 });

    // A fixed, closed shape. A new field carrying event data would fail here before it could reach a lock screen.
    expect(Object.keys(transport.sent[0]!.payload).sort()).toEqual(["body", "tag", "title", "url"]);
  });

  it("carries no message id, no user id and no token", async () => {
    const { a, b, conv } = await matched();
    await enablePush(b);
    await addDevice(b, "phone");
    await goAway(b);
    const message = await sendMessage(a, conv, "hello", { db, now: T0 });
    await pushForRecipient(b.userId, { db, now: T0 });

    const everything = everythingSent();
    expect(everything).not.toContain(message.id);
    expect(everything).not.toContain(a.userId);
    expect(everything).not.toContain(b.userId);
  });
});

describe("checkout reminder push destination (§12.19)", () => {
  it("opens that order's payment screen, not generic settings", async () => {
    const member = await createUser(db, { now: T0 });
    await enablePush(member, { pushAccount: true });
    await addDevice(member, "phone");
    await goAway(member);
    await db.notification.create({ data: { userId: member.userId, type: "ACCOUNT_NOTICE", data: { kind: "CHECKOUT_REMINDER", orderId: "ordr1234abcd5678" }, createdAt: T0 } });

    expect(await pushForRecipient(member.userId, { db, now: T0 })).toEqual(["sent"]);
    expect(transport.sent[0]!.payload.url).toBe("/settings/membership/order/ordr1234abcd5678?from=checkout_recovery");
    // Still says nothing about money, plans or orders on a lock screen.
    expect(transport.sent[0]!.payload.title).toBe("Account notice");
  });

  it("leaves every other destination exactly as it was", () => {
    expect(pushUrlFor({ kind: "ACCOUNT_NOTICE" })).toBe("/settings");
    expect(pushUrlFor({ kind: "ACCOUNT_NOTICE", data: { kind: "SOMETHING_ELSE", orderId: "ordr1234abcd5678" } })).toBe("/settings");
    // A malformed id is never put into a URL.
    expect(pushUrlFor({ kind: "ACCOUNT_NOTICE", data: { kind: "CHECKOUT_REMINDER", orderId: "../../admin" } })).toBe("/settings");
    expect(pushUrlFor({ kind: "PAYMENT_APPROVED", data: { kind: "CHECKOUT_REMINDER", orderId: "ordr1234abcd5678" } })).toBe("/settings/membership");
    expect(pushUrlFor({ kind: "LIKE_RECEIVED", data: { kind: "CHECKOUT_REMINDER", orderId: "ordr1234abcd5678" } })).toBe("/likes");
    expect(pushUrlFor({ kind: "SAFETY_NOTICE" })).toBe("/settings/safety");
  });
});

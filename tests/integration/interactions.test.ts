import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { addComment } from "@/server/community/comments";
import { createPost } from "@/server/community/posts";
import { listCommentReactors, listPostReactors, setCommentReaction, setPostReaction } from "@/server/community/reactions";
import { editMessage, listMessages, markConversationRead, pollConversation, sendMessage } from "@/server/conversations/messages";
import { unmatchConversation } from "@/server/conversations/unmatch";
import { listMessageReactors, setMessageReaction } from "@/server/conversations/reactions";
import { likeUser } from "@/server/likes/like";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, type TestUser } from "../helpers/factory";

/*
 * Replies, edits and reactions (docs/ARCHITECTURE.md §9.4, §14.10).
 *
 * The rule these tests exist to hold down is that NONE of this is decided by the client. The UI offers Edit on
 * your own bubble and a picker on a message you can see; every assertion below calls the domain function directly,
 * the way a forged request would, and expects the server to refuse on its own.
 *
 * The second rule is idempotency. A reaction is state, not an event: it can be set twice, replaced, removed, and
 * removed again, and the row count, the post counter and the recipient's notifications must all end up saying the
 * same thing however many times the call was made.
 */

const db = testDb();
const T0 = new Date("2026-09-20T10:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const deps = (now = T0) => ({ db, storage, now });

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

/** A matched pair with an open conversation — the only state in which chat writes are allowed at all. */
async function matched(now = T0): Promise<{ a: TestUser; b: TestUser; conv: string }> {
  const a = await createUser(db, { now });
  const b = await createUser(db, { now });
  await likeUser(a, b.userId, { db, now });
  const r = await likeUser(b, a.userId, { db, now });
  if (!r.matched || !r.conversationId) throw new Error("expected a match");
  return { a, b, conv: r.conversationId };
}

/** Community reactions are off by default (NotificationSettings.community defaults to false). */
const wantsCommunity = (userId: string) =>
  db.notificationSettings.upsert({ where: { userId }, create: { userId, community: true }, update: { community: true } });

// ───────────────────────────── Replies ─────────────────────────────

describe("replying to a chat message", () => {
  it("stores a reference to the original, never a copy of its text", async () => {
    const { a, b, conv } = await matched();
    const original = await sendMessage(a, conv, "Ferry at six?", { db, now: T0 });
    const reply = await sendMessage(b, conv, "Make it seven", { db, now: at(T0, 1000), replyToMessageId: original.id });

    const row = await db.message.findUniqueOrThrow({ where: { id: reply.id } });
    expect(row.replyToMessageId).toBe(original.id);
    // The quoted words appear NOWHERE in the reply's own row. Quoting by value would freeze a sentence the author
    // may still edit, and would put a second copy of someone's words in a row they do not own.
    expect(row.body).toBe("Make it seven");
    expect(row.body).not.toContain("Ferry");

    const page = await listMessages(b, conv, { db, limit: 10 });
    const hydrated = page.messages.find((m) => m.id === reply.id)!;
    expect(hydrated.replyTo).toEqual({ id: original.id, fromMe: false, body: "Ferry at six?", available: true });
  });

  it("shows the ORIGINAL'S CURRENT text in the quote after the original is edited", async () => {
    const { a, b, conv } = await matched();
    const original = await sendMessage(a, conv, "Ferry at six?", { db, now: T0 });
    await sendMessage(b, conv, "Sure", { db, now: at(T0, 1000), replyToMessageId: original.id });
    await editMessage(a, original.id, "Ferry at eight?", { db, now: at(T0, 2000) });

    const page = await listMessages(b, conv, { db, limit: 10 });
    // This is the whole reason the reference is stored rather than the text.
    expect(page.messages.find((m) => m.replyTo)!.replyTo!.body).toBe("Ferry at eight?");
  });

  it("REFUSES a reply to a message in a different conversation", async () => {
    const first = await matched();
    const second = await matched(at(T0, 10));
    const elsewhere = await sendMessage(second.a, second.conv, "Private to the other chat", { db, now: T0 });

    // The sender is a participant in BOTH conversations, so this is not a membership failure — it is the
    // same-conversation rule, and it is the server's to enforce.
    await expect(sendMessage(first.a, first.conv, "leak?", { db, now: T0, replyToMessageId: elsewhere.id })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.message.count({ where: { conversationId: first.conv } })).toBe(0);
  });

  it("refuses a reply to an id that does not exist, and to a soft-deleted message", async () => {
    const { a, b, conv } = await matched();
    const gone = await sendMessage(a, conv, "this will go", { db, now: T0 });
    await db.message.update({ where: { id: gone.id }, data: { deletedAt: at(T0, 500) } });

    await expect(sendMessage(b, conv, "x", { db, now: T0, replyToMessageId: "nope" })).rejects.toBeInstanceOf(ValidationError);
    await expect(sendMessage(b, conv, "x", { db, now: T0, replyToMessageId: gone.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("renders a reply whose target was deleted AFTERWARDS as unavailable, and keeps the reply itself", async () => {
    const { a, b, conv } = await matched();
    const original = await sendMessage(a, conv, "Ferry at six?", { db, now: T0 });
    const reply = await sendMessage(b, conv, "Make it seven", { db, now: at(T0, 1000), replyToMessageId: original.id });
    await db.message.update({ where: { id: original.id }, data: { deletedAt: at(T0, 2000) } });

    const page = await listMessages(b, conv, { db, limit: 10 });
    const hydrated = page.messages.find((m) => m.id === reply.id)!;
    // The reply is still something a person said, so it survives its target. Only the quote degrades.
    expect(hydrated.body).toBe("Make it seven");
    expect(hydrated.replyTo).toEqual({ id: original.id, fromMe: false, body: null, available: false });
  });

  it("produces exactly ONE notification for a reply — the same one any message produces", async () => {
    const { a, b, conv } = await matched();
    const original = await sendMessage(b, conv, "Ferry at six?", { db, now: T0 });
    await sendMessage(a, conv, "Make it seven", { db, now: at(T0, 1000), replyToMessageId: original.id });

    // A reply is a message. A second "replied to you" row would be one act reported twice.
    const types = (await db.notification.findMany({ where: { userId: b.userId }, select: { type: true } })).map((r) => r.type).sort();
    // LIKE_RECEIVED and NEW_MATCH are owed by the match itself; the reply contributes exactly one MESSAGE row.
    expect(types).toEqual(["LIKE_RECEIVED", "MESSAGE", "NEW_MATCH"]);
    expect(types.filter((t) => t === "MESSAGE")).toHaveLength(1);
  });
});

// ───────────────────────────── Editing ─────────────────────────────

describe("editing a chat message", () => {
  it("rewrites the body in place, preserving createdAt and the id, and records editedAt", async () => {
    const { a, conv } = await matched();
    const sent = await sendMessage(a, conv, "Ferry at six?", { db, now: T0 });
    const before = await db.message.findUniqueOrThrow({ where: { id: sent.id } });

    const edited = await editMessage(a, sent.id, "Ferry at eight?", { db, now: at(T0, 60_000) });

    expect(edited.id).toBe(sent.id);
    expect(edited.body).toBe("Ferry at eight?");
    expect(edited.editedAt).toBe(at(T0, 60_000).toISOString());
    const after = await db.message.findUniqueOrThrow({ where: { id: sent.id } });
    // Not a new message: same row, same position in the thread, same cursor.
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect(await db.message.count({ where: { conversationId: conv } })).toBe(1);
  });

  it("REFUSES to edit another user's message, even called directly", async () => {
    const { a, b, conv } = await matched();
    const theirs = await sendMessage(a, conv, "mine, not yours", { db, now: T0 });

    // b is a legitimate participant and can read this message. Reading is not owning.
    await expect(editMessage(b, theirs.id, "hijacked", { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(NotFoundError);
    const row = await db.message.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(row.body).toBe("mine, not yours");
    expect(row.editedAt).toBeNull();
  });

  it("refuses an empty or whitespace-only edit, and an over-long one", async () => {
    const { a, conv } = await matched();
    const sent = await sendMessage(a, conv, "something", { db, now: T0 });
    for (const body of ["", "   ", "\n\t "]) {
      await expect(editMessage(a, sent.id, body, { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(editMessage(a, sent.id, "x".repeat(2001), { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(ValidationError);
    expect((await db.message.findUniqueOrThrow({ where: { id: sent.id } })).body).toBe("something");
  });

  it("refuses an edit from a non-participant and in a conversation that has ended", async () => {
    const { a, b, conv } = await matched();
    const outsider = await createUser(db, { now: T0 });
    const sent = await sendMessage(a, conv, "hello", { db, now: T0 });

    await expect(editMessage(outsider, sent.id, "not mine", { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(NotFoundError);
    // Blocked: the conversation stops being reachable at all, so an edit cannot reach it either.
    await blockUser(b, a.userId, { db, now: at(T0, 2000) });
    await expect(editMessage(a, sent.id, "after the block", { db, now: at(T0, 3000) })).rejects.toBeInstanceOf(NotFoundError);
    expect((await db.message.findUniqueOrThrow({ where: { id: sent.id } })).body).toBe("hello");
  });

  it("refuses to edit a SYSTEM line, which is nobody's words", async () => {
    const { a, conv } = await matched();
    const system = await db.message.create({ data: { conversationId: conv, senderId: a.userId, kind: "SYSTEM", body: "You matched", createdAt: T0 } });
    await expect(editMessage(a, system.id, "rewritten", { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(ValidationError);
  });
});

// ───────────────────────────── Chat reactions ─────────────────────────────

describe("reacting to a chat message", () => {
  it("adds, then REPLACES rather than accumulating, then removes", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });

    const added = await setMessageReaction(b, m.id, "HEART", { db, now: at(T0, 1000) });
    expect(added.reactions).toEqual({ groups: [{ emoji: "HEART", count: 1, mine: true }], total: 1, mine: "HEART" });

    const swapped = await setMessageReaction(b, m.id, "LAUGH", { db, now: at(T0, 2000) });
    expect(swapped.reactions).toEqual({ groups: [{ emoji: "LAUGH", count: 1, mine: true }], total: 1, mine: "LAUGH" });
    // One row per person per message is the primary key, so a replacement cannot leave the old one behind.
    expect(await db.messageReaction.count({ where: { messageId: m.id } })).toBe(1);

    const removed = await setMessageReaction(b, m.id, null, { db, now: at(T0, 3000) });
    expect(removed.reactions).toEqual({ groups: [], total: 0, mine: null });
    expect(await db.messageReaction.count({ where: { messageId: m.id } })).toBe(0);
  });

  it("IS IDEMPOTENT: the same reaction set repeatedly, and removed repeatedly, changes nothing", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });

    // Declarative, not a toggle: this is what makes a retried request on a flaky connection harmless.
    for (let i = 0; i < 4; i += 1) await setMessageReaction(b, m.id, "FIRE", { db, now: at(T0, 1000 + i) });
    expect(await db.messageReaction.count({ where: { messageId: m.id } })).toBe(1);
    const state = await setMessageReaction(b, m.id, "FIRE", { db, now: at(T0, 5000) });
    expect(state.reactions.mine).toBe("FIRE");

    for (let i = 0; i < 3; i += 1) await setMessageReaction(b, m.id, null, { db, now: at(T0, 6000 + i) });
    expect(await db.messageReaction.count({ where: { messageId: m.id } })).toBe(0);
  });

  it("survives concurrent duplicate requests without creating a second row", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });
    await Promise.all([
      setMessageReaction(b, m.id, "WOW", { db, now: at(T0, 1000) }),
      setMessageReaction(b, m.id, "WOW", { db, now: at(T0, 1000) }),
      setMessageReaction(b, m.id, "WOW", { db, now: at(T0, 1000) }),
    ]);
    expect(await db.messageReaction.count({ where: { messageId: m.id } })).toBe(1);
  });

  it("counts both participants separately and reports each viewer's own reaction", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });
    await setMessageReaction(a, m.id, "HEART", { db, now: at(T0, 1000) });
    await setMessageReaction(b, m.id, "HEART", { db, now: at(T0, 2000) });

    const forA = (await listMessages(a, conv, { db, limit: 10 })).messages[0]!;
    expect(forA.reactions).toEqual({ groups: [{ emoji: "HEART", count: 2, mine: true }], total: 2, mine: "HEART" });

    await setMessageReaction(b, m.id, null, { db, now: at(T0, 3000) });
    const afterB = (await listMessages(a, conv, { db, limit: 10 })).messages[0]!;
    // A's own heart is untouched by B removing theirs.
    expect(afterB.reactions).toEqual({ groups: [{ emoji: "HEART", count: 1, mine: true }], total: 1, mine: "HEART" });
  });

  it("REFUSES a reaction from someone who is not in the conversation, and rejects values outside the set", async () => {
    const { a, conv } = await matched();
    const outsider = await createUser(db, { now: T0 });
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });

    await expect(setMessageReaction(outsider, m.id, "HEART", { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(NotFoundError);
    // Cast past the type, the way a forged request arrives. The set is closed at every layer, this one included.
    await expect(setMessageReaction(a, m.id, "SHRUG" as never, { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(ValidationError);
    await expect(setMessageReaction(a, "does-not-exist", "HEART", { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.messageReaction.count()).toBe(0);
  });

  it("refuses a reaction across a block — in BOTH directions", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });
    await blockUser(b, a.userId, { db, now: at(T0, 1000) });
    // Symmetric, and NotFound both ways: a block hides the conversation from the blocker too, so neither side can
    // learn anything from the error it gets.
    await expect(setMessageReaction(a, m.id, "HEART", { db, now: at(T0, 2000) })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setMessageReaction(b, m.id, "HEART", { db, now: at(T0, 2000) })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.messageReaction.count()).toBe(0);
  });

  it("refuses a reaction and an edit once the conversation has ended", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });
    await unmatchConversation(b, conv, { db, now: at(T0, 1000) });

    // Unmatched rather than blocked: the history stays readable, which is why this is InvalidState and not
    // NotFound — the conversation is still the actor's, it is simply closed.
    await expect(setMessageReaction(a, m.id, "HEART", { db, now: at(T0, 2000) })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(editMessage(a, m.id, "changed my mind", { db, now: at(T0, 2000) })).rejects.toBeInstanceOf(InvalidStateError);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).body).toBe("hedhikaa?");
  });

  it("names who reacted, and with what", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });
    await setMessageReaction(a, m.id, "HEART", { db, now: at(T0, 1000) });
    await setMessageReaction(b, m.id, "LAUGH", { db, now: at(T0, 2000) });

    const list = await listMessageReactors(a, m.id, { db });
    expect(list).toEqual([
      { emoji: "HEART", name: "You", isMe: true },
      { emoji: "LAUGH", name: expect.any(String), isMe: false },
    ]);
  });

  it("propagates through the poll only when the watermark has moved", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });

    // A has the message and nothing has happened to it: no watermark, nothing to re-send.
    const quiet = await pollConversation(a, conv, { db, afterId: m.id, sinceInteractionAt: null, now: at(T0, 1000) });
    expect(quiet.interactionAt).toBeNull();
    expect(quiet.updates).toEqual([]);

    await setMessageReaction(b, m.id, "HEART", { db, now: at(T0, 2000) });

    const moved = await pollConversation(a, conv, { db, afterId: m.id, sinceInteractionAt: null, now: at(T0, 3000) });
    expect(moved.interactionAt).toBe(at(T0, 2000).toISOString());
    // The message A already holds comes back carrying its new state — the incremental poll alone never would.
    expect(moved.updates.map((u) => [u.id, u.reactions.total])).toEqual([[m.id, 1]]);

    // Handed the watermark back, the poll goes quiet again rather than re-sending the same window forever.
    const settled = await pollConversation(a, conv, { db, afterId: m.id, sinceInteractionAt: moved.interactionAt, now: at(T0, 4000) });
    expect(settled.updates).toEqual([]);
  });
});

// ───────────────────────────── Community reactions ─────────────────────────────

describe("reacting to Community posts and comments", () => {
  it("adds, replaces and removes a POST reaction, keeping likeCount exact", async () => {
    const author = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0 });
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());

    await setPostReaction(fan, p.id, "HEART", { db, now: at(T0, 1000) });
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: p.id } })).likeCount).toBe(1);

    // A replacement is one row changing, so the counter must NOT move.
    const swapped = await setPostReaction(fan, p.id, "FIRE", { db, now: at(T0, 2000) });
    expect(swapped.likeCount).toBe(1);
    expect(swapped.reactions).toEqual({ groups: [{ emoji: "FIRE", count: 1, mine: true }], total: 1, mine: "FIRE" });
    expect(await db.communityLike.count({ where: { postId: p.id } })).toBe(1);

    const removed = await setPostReaction(fan, p.id, null, { db, now: at(T0, 3000) });
    expect(removed.likeCount).toBe(0);
    expect(removed.reactions.mine).toBeNull();
  });

  it("keeps likeCount exact under concurrent duplicate post reactions", async () => {
    const author = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0 });
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());
    await Promise.all(Array.from({ length: 5 }, () => setPostReaction(fan, p.id, "WOW", { db, now: at(T0, 1000) })));
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: p.id } })).likeCount).toBe(1);
    expect(await db.communityLike.count({ where: { postId: p.id } })).toBe(1);
  });

  it("treats a pre-existing like as the ❤️ it always was", async () => {
    const author = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0 });
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());
    // A row written before reactions existed: no emoji given, so the column default decides.
    await db.$executeRaw`INSERT INTO "CommunityLike" ("postId", "userId", "createdAt") VALUES (${p.id}, ${fan.userId}, ${T0})`;
    await db.communityPost.update({ where: { id: p.id }, data: { likeCount: 1 } });

    const page = await db.communityLike.findFirstOrThrow({ where: { postId: p.id } });
    expect(page.emoji).toBe("HEART");
  });

  it("adds, replaces and removes a COMMENT reaction", async () => {
    const author = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0 });
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());
    const c = await addComment(author, p.id, "agreed", deps(at(T0, 500)));

    const added = await setCommentReaction(fan, c.id, "SAD", { db, now: at(T0, 1000) });
    expect(added.reactions).toEqual({ groups: [{ emoji: "SAD", count: 1, mine: true }], total: 1, mine: "SAD" });
    await setCommentReaction(fan, c.id, "THUMBS_UP", { db, now: at(T0, 2000) });
    expect(await db.communityCommentReaction.count({ where: { commentId: c.id } })).toBe(1);
    const removed = await setCommentReaction(fan, c.id, null, { db, now: at(T0, 3000) });
    expect(removed.reactions.total).toBe(0);
  });

  it("carries comment reactions into the thread DTO for the right viewer", async () => {
    const author = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0 });
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());
    const c = await addComment(author, p.id, "agreed", deps(at(T0, 500)));
    await setCommentReaction(fan, c.id, "LAUGH", { db, now: at(T0, 1000) });

    const { listComments } = await import("@/server/community/comments");
    const forFan = await listComments(fan, p.id, {}, { db, storage });
    expect(forFan.comments[0]!.reactions).toEqual({ groups: [{ emoji: "LAUGH", count: 1, mine: true }], total: 1, mine: "LAUGH" });
    const forAuthor = await listComments(author, p.id, {}, { db, storage });
    // Same reaction, different viewer: `mine` is about who is asking.
    expect(forAuthor.comments[0]!.reactions).toEqual({ groups: [{ emoji: "LAUGH", count: 1, mine: false }], total: 1, mine: null });
  });

  it("REFUSES reactions on content the actor cannot see, and values outside the set", async () => {
    const author = await createUser(db, { now: T0 });
    const blocked = await createUser(db, { now: T0 });
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());
    const c = await addComment(author, p.id, "agreed", deps(at(T0, 500)));
    await blockUser(author, blocked.userId, { db, now: at(T0, 600) });

    await expect(setPostReaction(blocked, p.id, "HEART", { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCommentReaction(blocked, c.id, "HEART", { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setPostReaction(author, p.id, "NOPE" as never, { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(ValidationError);
    await expect(setCommentReaction(author, "missing", "HEART", { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(NotFoundError);

    // A deleted comment cannot be reacted to either.
    await db.communityComment.update({ where: { id: c.id }, data: { deletedAt: at(T0, 700) } });
    await expect(setCommentReaction(author, c.id, "HEART", { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.communityCommentReaction.count()).toBe(0);
  });

  it("names who reacted to a post and to a comment, and never names a blocked member", async () => {
    const author = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0 });
    const hidden = await createUser(db, { now: T0 });
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());
    const c = await addComment(author, p.id, "agreed", deps(at(T0, 500)));
    await setPostReaction(fan, p.id, "HEART", { db, now: at(T0, 1000) });
    await setCommentReaction(fan, c.id, "FIRE", { db, now: at(T0, 1000) });
    await setPostReaction(hidden, p.id, "WOW", { db, now: at(T0, 1100) });
    // Blocked AFTER reacting: the reaction still counts, the person is simply not named to this viewer.
    await blockUser(author, hidden.userId, { db, now: at(T0, 1200) });

    const postReactors = await listPostReactors(author, p.id, { db, storage });
    expect(postReactors.map((r) => r.emoji)).toEqual(["HEART"]);
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: p.id } })).likeCount).toBe(2);

    const commentReactors = await listCommentReactors(author, c.id, { db, storage });
    expect(commentReactors).toHaveLength(1);
    expect(commentReactors[0]!.emoji).toBe("FIRE");
  });
});

// ───────────────────────────── Notifications ─────────────────────────────

describe("reaction notifications", () => {
  it("tells the message's sender once, and NOT AGAIN however many times the reaction changes", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });

    await setMessageReaction(b, m.id, "HEART", { db, now: at(T0, 1000) });
    let rows = await db.notification.findMany({ where: { userId: a.userId, type: "MESSAGE_REACTION" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toEqual({ emoji: "HEART", targetId: m.id });
    const firstCreatedAt = rows[0]!.createdAt.getTime();

    // Four more changes in as many seconds. The waiting row is rewritten to say what is true NOW; it is never
    // duplicated, and its createdAt does not move, so it cannot jump back to the top of the feed on every tap.
    for (const [i, emoji] of (["LAUGH", "WOW", "SAD", "FIRE"] as const).entries()) {
      await setMessageReaction(b, m.id, emoji, { db, now: at(T0, 2000 + i * 1000) });
    }
    rows = await db.notification.findMany({ where: { userId: a.userId, type: "MESSAGE_REACTION" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toEqual({ emoji: "FIRE", targetId: m.id });
    expect(rows[0]!.createdAt.getTime()).toBe(firstCreatedAt);
  });

  it("NEVER notifies for your own reaction", async () => {
    const { a, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });
    await setMessageReaction(a, m.id, "HEART", { db, now: at(T0, 1000) });
    expect(await db.notification.count({ where: { type: "MESSAGE_REACTION" } })).toBe(0);
  });

  it("NEVER notifies when a reaction is REMOVED", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });
    await setMessageReaction(b, m.id, "HEART", { db, now: at(T0, 1000) });
    const before = await db.notification.count({ where: { userId: a.userId, type: "MESSAGE_REACTION" } });
    expect(before).toBe(1);

    await setMessageReaction(b, m.id, null, { db, now: at(T0, 2000) });
    // Nothing added. Removal is silent by construction: the callers only notify when a new emoji is SET.
    expect(await db.notification.count({ where: { userId: a.userId, type: "MESSAGE_REACTION" } })).toBe(1);

    // And on a message with no prior reaction at all, a removal creates nothing from nothing.
    const other = await sendMessage(a, conv, "and this one", { db, now: at(T0, 2500) });
    await setMessageReaction(b, other.id, null, { db, now: at(T0, 3000) });
    expect(await db.notification.count({ where: { userId: a.userId, type: "MESSAGE_REACTION" } })).toBe(1);
  });

  it("starts a NEW row once the previous one has been read", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });
    await setMessageReaction(b, m.id, "HEART", { db, now: at(T0, 1000) });
    await markConversationRead(a, conv, { db, now: at(T0, 2000) });
    await db.notification.updateMany({ where: { userId: a.userId, type: "MESSAGE_REACTION" }, data: { readAt: at(T0, 2000) } });
    await setMessageReaction(b, m.id, "FIRE", { db, now: at(T0, 3000) });

    // Dedup is per UNREAD row: once seen, a later reaction is genuinely new news.
    expect(await db.notification.count({ where: { userId: a.userId, type: "MESSAGE_REACTION" } })).toBe(2);
  });

  it("concurrent duplicate reactions create at most one notification", async () => {
    const { a, b, conv } = await matched();
    const m = await sendMessage(a, conv, "hedhikaa?", { db, now: T0 });
    await Promise.all(Array.from({ length: 4 }, () => setMessageReaction(b, m.id, "HEART", { db, now: at(T0, 1000) })));
    expect(await db.notification.count({ where: { userId: a.userId, type: "MESSAGE_REACTION" } })).toBe(1);
  });

  it("reports a POST reaction through the existing COMMUNITY_LIKE path, carrying the emoji", async () => {
    const author = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0 });
    await wantsCommunity(author.userId);
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());

    await setPostReaction(fan, p.id, "LAUGH", { db, now: at(T0, 1000) });
    const rows = await db.notification.findMany({ where: { userId: author.userId } });
    // ONE producer for reacting to a post. There is deliberately no COMMUNITY_POST_REACTION type to duplicate it.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("COMMUNITY_LIKE");
    expect(rows[0]!.data).toEqual({ emoji: "LAUGH" });

    await setPostReaction(fan, p.id, "FIRE", { db, now: at(T0, 2000) });
    const after = await db.notification.findMany({ where: { userId: author.userId } });
    expect(after).toHaveLength(1);
    expect(after[0]!.data).toEqual({ emoji: "FIRE" });
  });

  it("reports a COMMENT reaction to the comment's author, linked to the post", async () => {
    const author = await createUser(db, { now: T0 });
    const commenter = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0 });
    await wantsCommunity(commenter.userId);
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());
    const c = await addComment(commenter, p.id, "agreed", deps(at(T0, 500)));

    await setCommentReaction(fan, c.id, "HEART", { db, now: at(T0, 1000) });
    const rows = await db.notification.findMany({ where: { userId: commenter.userId, type: "COMMUNITY_COMMENT_REACTION" } });
    expect(rows).toHaveLength(1);
    // `postId` gives the row both its dedup scope and somewhere to link to; the comment id rides in `data`.
    expect(rows[0]!.postId).toBe(p.id);
    expect(rows[0]!.data).toEqual({ emoji: "HEART", targetId: c.id });
  });

  it("honours the recipient's notification settings and never crosses a block", async () => {
    const author = await createUser(db, { now: T0 });
    const fan = await createUser(db, { now: T0 });
    const p = await createPost(author, { kind: "TEXT", body: "benches" }, deps());

    // Community notifications are OFF by default, exactly as in the prototype.
    await setPostReaction(fan, p.id, "HEART", { db, now: at(T0, 1000) });
    expect(await db.notification.count({ where: { userId: author.userId } })).toBe(0);

    const { a, b, conv } = await matched(at(T0, 10));
    const m = await sendMessage(a, conv, "hi", { db, now: T0 });
    await db.notificationSettings.upsert({ where: { userId: a.userId }, create: { userId: a.userId, messages: false }, update: { messages: false } });
    await setMessageReaction(b, m.id, "HEART", { db, now: at(T0, 1000) });
    expect(await db.notification.count({ where: { userId: a.userId, type: "MESSAGE_REACTION" } })).toBe(0);
  });
});

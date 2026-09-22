/**
 * The one way a reaction becomes a notification (docs/ARCHITECTURE.md §13.3).
 *
 * WHY THIS FILE EXISTS AT ALL, rather than a `notification.create` beside each reaction:
 *
 * Reactions are the most repeatable action in the product. Tapping ❤️, changing your mind to 😂, changing back,
 * removing it — four taps in five seconds, all on the same message, and the person on the other end must end up
 * with ONE row that says the true thing, not four rows, and not one row per tap. Every existing notification
 * producer (a match, a like, a message, a comment) is an event that happens once; a reaction is a piece of state
 * that can be edited, and that difference is what this file is about.
 *
 * So the rule is: at most one UNREAD notification per (recipient, type, target, actor). A repeat does not create a
 * second row — it UPDATES the one already waiting, so a reaction changed from ❤️ to 😂 reads as 😂 rather than as
 * two notifications or as a stale one. `createdAt` is deliberately NOT moved: refreshing it would jump the row
 * back to the top of the feed on every tap, which is the spammy behaviour wearing a different hat. Once the
 * recipient has read it, the next reaction is genuinely new and starts a new row.
 *
 * Idempotency is enforced, not hoped for. The read-then-write below is inside the caller's transaction AND behind
 * an advisory lock on the exact tuple being written, which is the same technique this codebase already uses to
 * make a send serial (`msg:<sender>`) and a receipt's duplicate check honest (`txn:<hash>`). Two concurrent
 * requests from the same person cannot both see "no unread row" and both insert: the second waits for the first
 * to commit and then finds it. A plain `findFirst` + `create` — the shape the older producers use — is only safe
 * because those events cannot race with themselves the way a double-tapped reaction can.
 *
 * This file adds NO path capable of producing a duplicate. There is deliberately no notification for a reaction to
 * a POST here either: that is the existing COMMUNITY_LIKE producer in src/server/community/notify.ts, which now
 * carries the emoji, because the heart on a post card became the reaction control instead of gaining a rival.
 */
import type { Tx } from "@/lib/db";
import type { ReactionKey } from "@/lib/reactions";
import { isBlockedEitherWay } from "@/server/safety/block";

export type ReactionNotificationType = "MESSAGE_REACTION" | "COMMUNITY_COMMENT_REACTION";

export interface ReactionNotificationInput {
  type: ReactionNotificationType;
  recipientId: string;
  actorId: string;
  emoji: ReactionKey;
  /** Set for MESSAGE_REACTION. Gives the row its destination and its dedup scope. */
  conversationId?: string | null;
  /** Set for COMMUNITY_COMMENT_REACTION: the comment's post, so the row can link to the thread. */
  postId?: string | null;
  /** The precise target, for the row's text. Not a column — there is no FK to add for it. */
  targetId: string;
  now: Date;
}

/** Which notification setting governs this type. Chat reactions follow messages; Community follows community. */
const SETTING: Record<ReactionNotificationType, "messages" | "community"> = {
  MESSAGE_REACTION: "messages",
  COMMUNITY_COMMENT_REACTION: "community",
};

/**
 * Records a reaction notification, or deliberately records nothing. Returns whether a NEW row was created, which
 * is what the tests assert on: "the fifth change in ten seconds created no new notification" is a claim about
 * this boolean.
 *
 * Silent, by design, when:
 *   - the actor is the recipient (nobody is told about their own reaction);
 *   - either party has blocked the other;
 *   - the recipient has that category of notification switched off;
 *   - an unread row for this exact tuple already exists (it is updated in place instead).
 *
 * Removing a reaction never reaches here at all: the callers only notify when a new emoji is set.
 */
export async function notifyReaction(tx: Tx, input: ReactionNotificationInput): Promise<boolean> {
  if (input.recipientId === input.actorId) return false;
  if (await isBlockedEitherWay(tx, input.recipientId, input.actorId)) return false;

  const settings = await tx.notificationSettings.findUnique({
    where: { userId: input.recipientId },
    select: { messages: true, community: true },
  });
  const field = SETTING[input.type];
  // `messages` defaults to true and `community` to false in the schema; a row that does not exist yet means the
  // default, which is why the fallback below is not simply `true`.
  const wants = settings ? settings[field] : field === "messages";
  if (!wants) return false;

  const conversationId = input.conversationId ?? null;
  const postId = input.postId ?? null;

  /*
   * The scope key is the tuple the uniqueness is about. It is built from the same values the WHERE below matches
   * on, so the lock and the query cannot drift apart.
   */
  const scope = `notif:${input.type}:${input.recipientId}:${input.actorId}:${conversationId ?? postId ?? ""}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;

  const existing = await tx.notification.findFirst({
    where: { userId: input.recipientId, type: input.type, actorId: input.actorId, conversationId, postId, readAt: null },
    select: { id: true },
  });

  const data = { emoji: input.emoji, targetId: input.targetId };
  if (existing) {
    // The waiting row is rewritten to say what is true now. Same row, same position in the feed.
    await tx.notification.update({ where: { id: existing.id }, data: { data } });
    return false;
  }

  await tx.notification.create({
    data: { userId: input.recipientId, type: input.type, actorId: input.actorId, conversationId, postId, data, createdAt: input.now },
  });
  return true;
}

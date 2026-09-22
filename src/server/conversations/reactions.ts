/**
 * Reactions on chat messages (docs/ARCHITECTURE.md §9.4).
 *
 * One reaction per member per message, and that is a PRIMARY KEY, not a rule this file remembers to apply:
 * MessageReaction is keyed on (messageId, userId), so "add" is an upsert that conflicts with itself, "change" is
 * the UPDATE half of that upsert, and "remove" is a DELETE. A double tap, a retried request and a flaky mobile
 * connection replaying the same call all land on the same row. Nothing counts rows to decide what is allowed.
 *
 * Authorization is re-derived here from the message, never taken from the caller: a client sends a message id, and
 * this file finds out which conversation that message is in and then asks the ordinary question — is this person a
 * participant, is either of them blocked, is the conversation still open. `getConversationForActor` throws
 * NotFound rather than Forbidden, so a message id belonging to somebody else's conversation is indistinguishable
 * from one that does not exist and cannot be probed.
 */
import { MESSAGE_SPAM_CEILING } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { EMPTY_REACTIONS, isReactionKey, summarizeReactions, type ReactionKey, type ReactionSummaryDto } from "@/lib/reactions";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { assertMemberAccount } from "@/server/members/guard";
import { notifyReaction } from "@/server/notifications/reactions";
import { getConversationForActor } from "./messages";

/**
 * The reaction state of many messages in one query, keyed by message id.
 *
 * Callers pass ids they have ALREADY authorised (they came out of a conversation the actor is a participant in),
 * which is why this takes ids rather than an actor and a conversation: it is a hydration helper, not a gate.
 */
export async function loadMessageReactions(db: DbLike, viewerId: string, messageIds: readonly string[]): Promise<Map<string, ReactionSummaryDto>> {
  const out = new Map<string, ReactionSummaryDto>();
  const ids = [...new Set(messageIds)];
  if (ids.length === 0) return out;
  const rows = await db.messageReaction.findMany({
    where: { messageId: { in: ids } },
    select: { messageId: true, emoji: true, userId: true },
  });
  const byMessage = new Map<string, { emoji: string; userId: string }[]>();
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({ emoji: row.emoji, userId: row.userId });
    byMessage.set(row.messageId, list);
  }
  for (const id of ids) {
    const list = byMessage.get(id);
    out.set(id, list ? summarizeReactions(list, viewerId) : EMPTY_REACTIONS);
  }
  return out;
}

export interface MessageReactionResult {
  messageId: string;
  reactions: ReactionSummaryDto;
  /** New watermark for the conversation, so the caller's next poll does not re-fetch its own change. */
  interactionAt: string;
}

/**
 * Sets, replaces or clears the actor's reaction to one message.
 *
 * DECLARATIVE, not a toggle: `emoji` is the state the actor wants to end up in, and null means none. Sending ❤️
 * twice leaves one ❤️ rather than adding and then removing it, which is what "duplicate requests cannot create
 * duplicate reactions" actually requires — a toggle is by definition not idempotent, and a retried request on a
 * flaky phone connection would undo itself. Tapping your own active reaction to remove it is a decision the
 * client makes (it knows `reactions.mine`) and sends as null.
 */
export async function setMessageReaction(
  actor: Actor,
  messageId: string,
  emoji: ReactionKey | null,
  options: { db?: Db; now?: Date } = {},
): Promise<MessageReactionResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (emoji !== null && !isReactionKey(emoji)) throw new ValidationError("That isn't a reaction");
  await assertMemberAccount(db, actor.userId);

  const limit = await consumeRateLimit(db, `chat:react:${actor.userId}`, MESSAGE_SPAM_CEILING.reactionsPerMinute, 60_000, now);
  if (!limit.allowed) throw new ValidationError("Slow down a little.");

  return db.$transaction(async (tx) => {
    const message = await tx.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, senderId: true, kind: true, deletedAt: true },
    });
    // NotFound for "gone" and for "not yours to see" alike: the difference is not something a client may learn.
    if (!message || message.deletedAt !== null) throw new NotFoundError("Message");
    // A SYSTEM line ("You matched with …") is not somebody's words and has no author to notify.
    if (message.kind === "SYSTEM") throw new ValidationError("That message can't be reacted to");

    const conversation = await getConversationForActor(tx, actor, message.conversationId);
    if (conversation.status !== "ACTIVE") throw new InvalidStateError("This conversation has ended");

    const next = emoji;

    if (next === null) {
      // deleteMany rather than delete: removing a reaction that is already gone is a no-op, not an error, so a
      // repeated "remove" is as idempotent as a repeated "set".
      await tx.messageReaction.deleteMany({ where: { messageId, userId: actor.userId } });
    } else {
      await tx.$executeRaw`
        INSERT INTO "MessageReaction" ("messageId", "userId", emoji, "createdAt", "updatedAt")
        VALUES (${messageId}, ${actor.userId}, ${next}::"ReactionEmoji", ${now}, ${now})
        ON CONFLICT ("messageId", "userId") DO UPDATE SET emoji = EXCLUDED.emoji, "updatedAt" = EXCLUDED."updatedAt"
      `;
    }

    /*
     * The watermark. `lastMessageAt` cannot carry this — it moves only for a new message, and the chat's poll asks
     * "anything after this id?", which never revisits a message the other client already holds. Without this
     * write a reaction would be invisible until the other person reloaded.
     */
    await tx.conversation.update({ where: { id: message.conversationId }, data: { interactionAt: now } });

    // Only a reaction that now EXISTS is worth telling anyone about. Removing one notifies nobody, and a reaction
    // to your own message notifies nobody either (notifyReaction refuses both).
    if (next !== null) {
      await notifyReaction(tx, {
        type: "MESSAGE_REACTION",
        recipientId: message.senderId,
        actorId: actor.userId,
        emoji: next,
        conversationId: message.conversationId,
        targetId: messageId,
        now,
      });
    }

    const reactions = await loadMessageReactions(tx, actor.userId, [messageId]);
    return { messageId, reactions: reactions.get(messageId) ?? EMPTY_REACTIONS, interactionAt: now.toISOString() };
  });
}

export interface ReactorDto {
  emoji: ReactionKey;
  /** The member's display name, or "You". Never an id. */
  name: string;
  isMe: boolean;
}

/**
 * Who reacted to one message, and with what — the list behind tapping a reaction summary.
 *
 * A conversation has exactly two participants, so this can only ever name you and the person you are talking to,
 * and it is authorised by the same conversation check as everything else. Reported in the picker's emoji order so
 * it reads the same way as the summary it was opened from.
 */
export async function listMessageReactors(actor: Actor, messageId: string, options: { db?: Db } = {}): Promise<ReactorDto[]> {
  const db = options.db ?? getDb();
  const message = await db.message.findUnique({ where: { id: messageId }, select: { conversationId: true, deletedAt: true } });
  if (!message || message.deletedAt !== null) throw new NotFoundError("Message");
  await getConversationForActor(db, actor, message.conversationId);

  const rows = await db.messageReaction.findMany({
    where: { messageId },
    orderBy: { createdAt: "asc" },
    select: { emoji: true, userId: true, user: { select: { profile: { select: { displayName: true } } } } },
  });
  return rows.flatMap((row) =>
    isReactionKey(row.emoji)
      ? [{
          emoji: row.emoji,
          name: row.userId === actor.userId ? "You" : row.user.profile?.displayName ?? "Someone",
          isMe: row.userId === actor.userId,
        }]
      : [],
  );
}

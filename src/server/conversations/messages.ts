/**
 * Conversation authorization and message sending (docs/ARCHITECTURE.md §9, §12.4, §12.11).
 */
import { MESSAGE_LIMITS, MESSAGE_SPAM_CEILING } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { InvalidStateError, MessageCooldownError, MessageRateLimitError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";

export interface MessageOptions {
  now?: Date;
  db?: Db;
}

/**
 * The only way to load a conversation on behalf of a user. Throws NotFound (never Forbidden) when the
 * actor is not a participant or the pair is blocked, so ids cannot be probed.
 */
export async function getConversationForActor(db: DbLike, actor: Actor, conversationId: string) {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, participants: { some: { userId: actor.userId } } },
    select: { id: true, status: true, userAId: true, userBId: true, lastMessageAt: true },
  });
  if (!conversation) throw new NotFoundError("Conversation");
  const otherId = conversation.userAId === actor.userId ? conversation.userBId : conversation.userAId;
  const blocked = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: actor.userId, blockedId: otherId },
        { blockerId: otherId, blockedId: actor.userId },
      ],
    },
    select: { id: true },
  });
  if (blocked) throw new NotFoundError("Conversation");
  return { ...conversation, otherUserId: otherId };
}

export interface SentMessage {
  id: string;
  conversationId: string;
  body: string;
  createdAt: Date;
  /** For Free users: when the next message may be sent. Equals createdAt for Plus. */
  nextAvailableAt: Date;
}

/**
 * Sends a text message. Transaction: per-sender advisory lock → entitlements → cooldown check against
 * the sender's last TEXT message → participant/status check → spam ceiling → insert → notify.
 */
export async function sendMessage(actor: Actor, conversationId: string, rawBody: string, options: MessageOptions = {}): Promise<SentMessage> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const body = rawBody.trim();
  if (body.length < MESSAGE_LIMITS.minLength) throw new ValidationError("Message is empty");
  if (body.length > MESSAGE_LIMITS.maxLength) throw new ValidationError("Message is too long");

  return db.$transaction(async (tx) => {
    // Serialise all sends by this user for the duration of the transaction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"msg:" + actor.userId}))`;

    const entitlements = await getEntitlements(tx, actor.userId, now);
    const cooldownMs = entitlements.rules.messageCooldownMs;
    if (cooldownMs > 0) {
      const last = await tx.message.findFirst({
        where: { senderId: actor.userId, kind: "TEXT" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (last) {
        const availableAt = new Date(last.createdAt.getTime() + cooldownMs);
        if (availableAt.getTime() > now.getTime()) throw new MessageCooldownError(availableAt);
      }
    }

    const conversation = await getConversationForActor(tx, actor, conversationId);
    if (conversation.status !== "ACTIVE") throw new InvalidStateError("This conversation is not open for messages");

    // Anti-spam ceiling for every tier.
    const recent = await tx.message.count({
      where: { senderId: actor.userId, createdAt: { gt: new Date(now.getTime() - 60_000) } },
    });
    if (recent >= MESSAGE_SPAM_CEILING.perMinute) throw new MessageRateLimitError();

    const message = await tx.message.create({
      data: { conversationId, senderId: actor.userId, kind: "TEXT", body, createdAt: now },
      select: { id: true, conversationId: true, body: true, createdAt: true },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });

    // One unread MESSAGE notification per conversation for the other participant.
    const wants = await tx.notificationSettings.findUnique({ where: { userId: conversation.otherUserId }, select: { messages: true } });
    if (wants?.messages ?? true) {
      const unread = await tx.notification.findFirst({
        where: { userId: conversation.otherUserId, type: "MESSAGE", conversationId, readAt: null },
        select: { id: true },
      });
      if (!unread) {
        await tx.notification.create({
          data: { userId: conversation.otherUserId, type: "MESSAGE", actorId: actor.userId, conversationId, createdAt: now },
        });
      }
    }

    return { ...message, nextAvailableAt: new Date(now.getTime() + cooldownMs) };
  });
}

export interface MessagePage {
  messages: { id: string; senderId: string; kind: string; body: string; createdAt: Date }[];
  nextCursor: string | null;
}

/** History, newest first, cursor-paginated. Reading is never subject to any cooldown. */
export async function listMessages(actor: Actor, conversationId: string, options: { cursor?: string; limit?: number; db?: Db } = {}): Promise<MessagePage> {
  const db = options.db ?? getDb();
  const limit = Math.min(options.limit ?? 50, 100);
  await getConversationForActor(db, actor, conversationId);
  const rows = await db.message.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: { id: true, senderId: true, kind: true, body: true, createdAt: true },
  });
  const hasMore = rows.length > limit;
  const messages = hasMore ? rows.slice(0, limit) : rows;
  return { messages, nextCursor: hasMore ? (messages[messages.length - 1]?.id ?? null) : null };
}

/** Marks the conversation read up to its latest message and clears MESSAGE notifications for it. */
export async function markConversationRead(actor: Actor, conversationId: string, options: MessageOptions = {}): Promise<void> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  await getConversationForActor(db, actor, conversationId);
  const latest = await db.message.findFirst({ where: { conversationId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  await db.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: actor.userId } },
    data: { lastReadMessageId: latest?.id ?? null, lastReadAt: now },
  });
  await db.notification.updateMany({
    where: { userId: actor.userId, type: "MESSAGE", conversationId, readAt: null },
    data: { readAt: now },
  });
}

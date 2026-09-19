/**
 * Conversation authorization, message sending, history, polling and read state
 * (docs/ARCHITECTURE.md §9, §12.4, §12.11). Built in Phase 3, completed in Phase 7.
 *
 * Messaging a match is free and unlimited on every tier. There is no cooldown, no quota and no per-message
 * charge, and no tier can reintroduce one — the rule does not exist in PRODUCT_RULES. What DOES still guard this
 * path, unchanged, is authorization and safety: the sender must be a participant in an ACTIVE conversation whose
 * match is ACTIVE, neither party may have blocked the other, and the 30-messages-per-minute anti-spam ceiling
 * applies to everybody, Plus included.
 */
import { MESSAGE_LIMITS, MESSAGE_SPAM_CEILING } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { InvalidStateError, MessageRateLimitError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { lockPair } from "@/server/locks";
import { isBlockedEitherWay } from "@/server/safety/block";

export interface MessageOptions {
  now?: Date;
  db?: Db;
}

/** Normalises line endings and strips control characters (keeps newlines and tabs); rendering is always as text. */
export function normalizeMessageBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\t" ? c : ""))
    .trim();
}

/**
 * The only way to load a conversation on behalf of a user. Throws NotFound (never Forbidden) when the
 * actor is not a participant or the pair is blocked, so ids cannot be probed. LOCKED conversations are
 * returned (read-only history); sending checks the status separately.
 */
export async function getConversationForActor(db: DbLike, actor: Actor, conversationId: string) {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, participants: { some: { userId: actor.userId } } },
    select: { id: true, status: true, userAId: true, userBId: true, lastMessageAt: true, matchId: true },
  });
  if (!conversation) throw new NotFoundError("Conversation");
  const otherId = conversation.userAId === actor.userId ? conversation.userBId : conversation.userAId;
  if (await isBlockedEitherWay(db as Db, actor.userId, otherId)) throw new NotFoundError("Conversation");
  return { ...conversation, otherUserId: otherId };
}

export interface SentMessage {
  id: string;
  conversationId: string;
  body: string;
  createdAt: Date;
}

/**
 * Sends a text message. Transaction: per-sender advisory lock → participant check → pair lock → block re-check →
 * conversation/match status → spam ceiling → insert → conversation activity → notify. Lock order (sender lock,
 * then pair lock) never conflicts with blockUser/unmatch (pair lock only) or likeUser (usage row, then pair lock).
 */
export async function sendMessage(actor: Actor, conversationId: string, rawBody: string, options: MessageOptions = {}): Promise<SentMessage> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const body = normalizeMessageBody(rawBody);
  if (body.length < MESSAGE_LIMITS.minLength) throw new ValidationError("Message is empty");
  if (body.length > MESSAGE_LIMITS.maxLength) throw new ValidationError(`Messages can be up to ${MESSAGE_LIMITS.maxLength} characters`);

  return db.$transaction(async (tx) => {
    // Serialise all sends by this user for the duration of the transaction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"msg:" + actor.userId}))`;

    // Authorization inside the transaction, under the pair lock, so a concurrent block or unmatch cannot slip a message through.
    const conversation = await getConversationForActor(tx, actor, conversationId);
    await lockPair(tx, actor.userId, conversation.otherUserId);
    if (await isBlockedEitherWay(tx, actor.userId, conversation.otherUserId)) throw new NotFoundError("Conversation");
    const fresh = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { status: true, match: { select: { status: true } } } });
    if (fresh.status !== "ACTIVE" || (fresh.match && fresh.match.status !== "ACTIVE")) throw new InvalidStateError("This conversation is not open for messages");

    // No entitlement check here, deliberately: messaging a match is unlimited on every tier. The only remaining
    // ceiling is anti-spam, and it applies to Free and Plus alike.
    const recent = await tx.message.count({
      where: { senderId: actor.userId, createdAt: { gt: new Date(now.getTime() - 60_000) } },
    });
    if (recent >= MESSAGE_SPAM_CEILING.perMinute) throw new MessageRateLimitError();

    const message = await tx.message.create({
      data: { conversationId, senderId: actor.userId, kind: "TEXT", body, createdAt: now },
      select: { id: true, conversationId: true, body: true, createdAt: true },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
    // The sender has by definition read everything up to their own message.
    await tx.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: actor.userId } },
      data: { lastReadMessageId: message.id, lastReadAt: now },
    });

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

    return message;
  });
}

// ───────────────────────────── DTOs ─────────────────────────────

export interface MessageDto {
  id: string;
  fromMe: boolean;
  kind: "TEXT" | "INTRO" | "SYSTEM";
  body: string;
  at: string;
}

export interface MessagePageDto {
  /** Newest first. */
  messages: MessageDto[];
  /** Cursor for the next OLDER page, or null. */
  nextCursor: string | null;
  serverNow: string;
}

function toMessageDto(actorId: string, m: { id: string; senderId: string; kind: string; body: string; createdAt: Date }): MessageDto {
  return { id: m.id, fromMe: m.senderId === actorId, kind: m.kind as MessageDto["kind"], body: m.body, at: m.createdAt.toISOString() };
}

/** History, newest first, cursor-paginated (bounded). */
export async function listMessages(actor: Actor, conversationId: string, options: { cursor?: string; limit?: number; db?: Db; now?: Date } = {}): Promise<MessagePageDto> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 100);
  await getConversationForActor(db, actor, conversationId);
  const rows = await db.message.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: { id: true, senderId: true, kind: true, body: true, createdAt: true },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { messages: page.map((m) => toMessageDto(actor.userId, m)), nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null, serverNow: now.toISOString() };
}

export interface PollDto {
  /** Messages newer than `afterId`, oldest first (bounded). */
  messages: MessageDto[];
  status: "ACTIVE" | "PENDING" | "LOCKED";
  serverNow: string;
}

/** Incremental poll: only messages after the newest one the client holds. Realtime can replace this without touching the UI. */
export async function pollConversation(actor: Actor, conversationId: string, options: { afterId?: string | null; limit?: number; db?: Db; now?: Date } = {}): Promise<PollDto> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const conversation = await getConversationForActor(db, actor, conversationId);
  let after: { createdAt: Date; id: string } | null = null;
  if (options.afterId) {
    after = await db.message.findFirst({ where: { id: options.afterId, conversationId }, select: { createdAt: true, id: true } });
  }
  const rows = await db.message.findMany({
    where: {
      conversationId,
      deletedAt: null,
      ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, senderId: true, kind: true, body: true, createdAt: true },
  });
  return { messages: rows.map((m) => toMessageDto(actor.userId, m)), status: conversation.status, serverNow: now.toISOString() };
}

/**
 * Marks the conversation read up to its latest message and clears MESSAGE notifications for it. Only called when the
 * actor views it. `unreadCleared` is true when this call actually changed unread state (incoming messages newer than
 * the previous read pointer, or pending notifications), so the client knows to refresh badges.
 */
export async function markConversationRead(actor: Actor, conversationId: string, options: MessageOptions = {}): Promise<{ unreadCleared: boolean }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  await getConversationForActor(db, actor, conversationId);
  const participant = await db.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: actor.userId } }, select: { lastReadAt: true } });
  const hadUnread = await db.message.count({
    where: { conversationId, deletedAt: null, senderId: { not: actor.userId }, ...(participant?.lastReadAt ? { createdAt: { gt: participant.lastReadAt } } : {}) },
  });
  const latest = await db.message.findFirst({ where: { conversationId, deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  await db.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: actor.userId } },
    data: { lastReadMessageId: latest?.id ?? null, lastReadAt: now },
  });
  const cleared = await db.notification.updateMany({
    where: { userId: actor.userId, type: "MESSAGE", conversationId, readAt: null },
    data: { readAt: now },
  });
  return { unreadCleared: hadUnread > 0 || cleared.count > 0 };
}

/** Number of conversations with at least one unread incoming message: the Chats badge. Derived from persisted read state. */
export async function countUnreadConversations(db: DbLike, userId: string): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n
    FROM "ConversationParticipant" cp
    JOIN "Conversation" c ON c.id = cp."conversationId"
    WHERE cp."userId" = ${userId}
      AND c.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM "Block" b
        WHERE (b."blockerId" = ${userId} AND b."blockedId" IN (c."userAId", c."userBId"))
           OR (b."blockedId" = ${userId} AND b."blockerId" IN (c."userAId", c."userBId"))
      )
      AND EXISTS (
        SELECT 1 FROM "Message" m
        WHERE m."conversationId" = c.id AND m."senderId" <> ${userId} AND m."deletedAt" IS NULL
          AND (cp."lastReadAt" IS NULL OR m."createdAt" > cp."lastReadAt")
      )
  `;
  return Number(rows[0]?.n ?? 0);
}

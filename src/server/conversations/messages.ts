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
import { EMPTY_REACTIONS, type ReactionSummaryDto } from "@/lib/reactions";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { lockPair } from "@/server/locks";
import { isBlockedEitherWay } from "@/server/safety/block";
import { assertMemberAccount } from "@/server/members/guard";
import { getConversationForActor } from "./access";
import { loadMessageReactions } from "./reactions";

export interface MessageOptions {
  now?: Date;
  db?: Db;
}

/**
 * How much of a quoted message travels with a reply. A quote is a pointer to something the reader can already
 * reach, not a second copy of it, so it needs to be recognisable and no longer.
 */
const QUOTE_CHARS = 120;

/**
 * How far back a poll looks when something changed about a message the client already holds.
 *
 * Reactions and edits are not "new messages", so the incremental poll (everything after id X) can never carry
 * them. When the conversation's watermark moves, the newest this many messages are re-sent with their current
 * state — comfortably more than the 40 of a first page, so the window a phone can actually be looking at is
 * covered. The honest limit: a reaction REMOVED from a message older than this does not reach a peer who is
 * scrolled that far back until they reload. Nothing is lost or wrong in the database; the screen is briefly
 * stale, and any new message or reload corrects it.
 */
const INTERACTION_WINDOW = 60;

/** Normalises line endings and strips control characters (keeps newlines and tabs); rendering is always as text. */
export function normalizeMessageBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\t" ? c : ""))
    .trim();
}

export { getConversationForActor } from "./access";

export interface SentMessage {
  id: string;
  conversationId: string;
  body: string;
  createdAt: Date;
}

/*
 * A REPLY DOES NOT GET ITS OWN NOTIFICATION, deliberately.
 *
 * A reply is a message. The MESSAGE notification below already fires for it, already says who sent it, and
 * already links to the conversation. Adding a "replied to you" row beside it would mean one act producing two
 * notifications — exactly the duplication this work was asked not to introduce — and the recipient learns nothing
 * from the second one that the first did not tell them.
 */

/**
 * Sends a text message. Transaction: per-sender advisory lock → participant check → pair lock → block re-check →
 * conversation/match status → spam ceiling → insert → conversation activity → notify. Lock order (sender lock,
 * then pair lock) never conflicts with blockUser/unmatch (pair lock only) or likeUser (usage row, then pair lock).
 */
export async function sendMessage(
  actor: Actor,
  conversationId: string,
  rawBody: string,
  options: MessageOptions & { replyToMessageId?: string | null } = {},
): Promise<SentMessage> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const body = normalizeMessageBody(rawBody);
  if (body.length < MESSAGE_LIMITS.minLength) throw new ValidationError("Message is empty");
  if (body.length > MESSAGE_LIMITS.maxLength) throw new ValidationError(`Messages can be up to ${MESSAGE_LIMITS.maxLength} characters`);
  await assertMemberAccount(db, actor.userId);

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

    /*
     * A reply may only point at a message the sender can already see, and "can see" is decided HERE rather than
     * trusted from the client: the id must resolve to a live message in THIS conversation. Scoping the lookup by
     * conversationId is the whole check — participation in this conversation was just proved above, and a message
     * in it is by definition visible to both participants. An id from another conversation, a deleted message or
     * an id that never existed all fail the same way, so nothing can be learned by trying.
     */
    let replyToMessageId: string | null = null;
    if (options.replyToMessageId) {
      const target = await tx.message.findFirst({
        where: { id: options.replyToMessageId, conversationId, deletedAt: null },
        select: { id: true },
      });
      if (!target) throw new ValidationError("That message can't be replied to");
      replyToMessageId = target.id;
    }

    const message = await tx.message.create({
      data: { conversationId, senderId: actor.userId, kind: "TEXT", body, createdAt: now, replyToMessageId },
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

/**
 * Rewrites the body of one of the actor's OWN messages.
 *
 * Ownership is enforced by the database, not by the UI that offered the option: `updateMany` is given
 * `{ id, senderId: actor.userId }` TOGETHER, so a request carrying somebody else's message id updates zero rows
 * and gets the same NotFound as an id that does not exist. There is no path here that reads the message, decides
 * it belongs to you, and then writes — the decision and the write are one statement.
 *
 * What is deliberately preserved:
 *   - `createdAt`. An edit is not a new message. Moving it would reorder the thread, break every cursor that has
 *     already paged past it, and lie about when the conversation happened.
 *   - the message id, so replies pointing at it keep pointing at it and their quotes now read the new text.
 *   - one row. This is an UPDATE; nothing is inserted, so the recipient's screen does not gain a message.
 *
 * And what still applies, unchanged: the same normalisation and length limits as sending, an empty result is
 * refused, the conversation must still be open, blocks are still checked (through getConversationForActor), and
 * there is an anti-abuse ceiling of its own so a body cannot be rewritten in a loop.
 */
export async function editMessage(actor: Actor, messageId: string, rawBody: string, options: MessageOptions = {}): Promise<MessageDto> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const body = normalizeMessageBody(rawBody);
  if (body.length < MESSAGE_LIMITS.minLength) throw new ValidationError("Message is empty");
  if (body.length > MESSAGE_LIMITS.maxLength) throw new ValidationError(`Messages can be up to ${MESSAGE_LIMITS.maxLength} characters`);
  await assertMemberAccount(db, actor.userId);

  const limit = await consumeRateLimit(db, `chat:edit:${actor.userId}`, MESSAGE_SPAM_CEILING.editsPerMinute, 60_000, now);
  if (!limit.allowed) throw new ValidationError("You're editing very quickly. Take a breath and try again.");

  const row = await db.$transaction(async (tx) => {
    // Nothing about the message is trusted from the caller: the conversation is looked up from the row itself,
    // and only then is the actor's access to that conversation established.
    const existing = await tx.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, senderId: true, kind: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt !== null) throw new NotFoundError("Message");
    const conversation = await getConversationForActor(tx, actor, existing.conversationId);
    if (conversation.status !== "ACTIVE") throw new InvalidStateError("This conversation has ended");
    // An INTRO is the opening line a Like carried and a SYSTEM line is not anybody's words; neither is editable.
    if (existing.kind !== "TEXT") throw new ValidationError("That message can't be edited");

    const changed = await tx.message.updateMany({
      where: { id: messageId, senderId: actor.userId, deletedAt: null, kind: "TEXT" },
      data: { body, editedAt: now },
    });
    // Zero rows means it was not this actor's message. Reported as NotFound, exactly as an unknown id would be.
    if (changed.count === 0) throw new NotFoundError("Message");

    // The edit changes a message the other client already holds, so the watermark has to move for the poll to
    // notice it — the same reason a reaction bumps it.
    await tx.conversation.update({ where: { id: existing.conversationId }, data: { interactionAt: now } });

    const updated = await tx.message.findUniqueOrThrow({ where: { id: messageId }, select: MESSAGE_SELECT });
    return { conversationId: existing.conversationId, updated };
  });

  const [dto] = await hydrateMessages(db, actor.userId, row.conversationId, [row.updated]);
  // hydrateMessages returns one DTO per row it is given, so a single row cannot come back empty.
  return dto!;
}

// ───────────────────────────── DTOs ─────────────────────────────
/**
 * When the other participant last read this conversation, or null when it must not be shown.
 *
 * Two people have to agree before a receipt is shown, and the rule is symmetric:
 *
 *   - the reader must allow receipts, because it is their behaviour being reported;
 *   - the viewer must allow them too, because otherwise turning the setting off would buy you the ability to
 *     watch without being watched. A receipt you receive but never give is not privacy, it is an advantage.
 *
 * Null is returned for every "no" — a blocked pair, a setting off, a conversation never opened — so the client
 * has one shape to render and can never distinguish "not read" from "not telling".
 */
export interface ConversationReadStateDto {
  /** ISO time the other participant last read this conversation, or null. */
  otherReadAt: string | null;
}

export async function getConversationReadState(
  db: DbLike,
  actorId: string,
  conversationId: string,
  otherUserId: string,
): Promise<ConversationReadStateDto> {
  const [mine, theirs, participant] = await Promise.all([
    db.privacySettings.findUnique({ where: { userId: actorId }, select: { readReceipts: true } }),
    db.privacySettings.findUnique({ where: { userId: otherUserId }, select: { readReceipts: true } }),
    db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: otherUserId } },
      select: { lastReadAt: true },
    }),
  ]);
  // The column defaults to true, so a row that does not exist yet means "on".
  if ((mine?.readReceipts ?? true) === false) return { otherReadAt: null };
  if ((theirs?.readReceipts ?? true) === false) return { otherReadAt: null };
  return { otherReadAt: participant?.lastReadAt?.toISOString() ?? null };
}


/**
 * The compact quote shown above a reply's own text.
 *
 * Resolved at READ time from `replyToMessageId`, never stored beside the reply. That is what makes an edited
 * original read correctly in every reply to it, and it means nobody's words are duplicated into a row they do
 * not own.
 */
export interface MessageQuoteDto {
  /** The quoted message's id, so tapping the quote can scroll to and highlight it. */
  id: string;
  /** Whose words are quoted — the client labels it "You" or the other person's name. */
  fromMe: boolean;
  /** The quoted text, truncated. Null when the original is no longer there. */
  body: string | null;
  /** False when the original was deleted or is otherwise gone: the client renders "Message unavailable". */
  available: boolean;
}

export interface MessageDto {
  id: string;
  fromMe: boolean;
  kind: "TEXT" | "INTRO" | "SYSTEM";
  body: string;
  at: string;
  /** Null unless this message is a reply. */
  replyTo: MessageQuoteDto | null;
  /** ISO time of the last edit, or null when never edited. Drives the "Edited" marker. */
  editedAt: string | null;
  /** Grouped counts and the viewer's own choice. Always present; empty when nobody has reacted. */
  reactions: ReactionSummaryDto;
}

export interface MessagePageDto {
  /** Newest first. */
  messages: MessageDto[];
  /** Cursor for the next OLDER page, or null. */
  nextCursor: string | null;
  serverNow: string;
  /** Only on the first page; older pages cannot change it. */
  readState?: ConversationReadStateDto;
  /**
   * The conversation's interaction watermark at the moment this page was built. The client hands it back on every
   * poll; when the server's has moved, something about a message already on screen has changed.
   */
  interactionAt?: string | null;
}

/** What every message query selects. One shape, so the hydration below cannot be given a partial row. */
const MESSAGE_SELECT = {
  id: true,
  senderId: true,
  kind: true,
  body: true,
  createdAt: true,
  editedAt: true,
  replyToMessageId: true,
} as const;

interface MessageRow {
  id: string;
  senderId: string;
  kind: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  replyToMessageId: string | null;
}

/**
 * The quoted messages for a page of replies, in one query.
 *
 * `conversationId` is in the WHERE clause and not merely assumed. The reply rows were written by a path that
 * already proved the target was in this conversation, but a second copy of that guarantee at read time costs one
 * clause and means a reply whose target somehow pointed elsewhere would render as unavailable rather than leaking
 * a sentence from another conversation.
 */
async function loadQuotes(db: DbLike, actorId: string, conversationId: string, ids: readonly string[]): Promise<Map<string, MessageQuoteDto>> {
  const out = new Map<string, MessageQuoteDto>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const rows = await db.message.findMany({
    where: { id: { in: unique }, conversationId, deletedAt: null },
    select: { id: true, senderId: true, body: true },
  });
  for (const row of rows) {
    const body = row.body.replace(/\s+/g, " ").trim();
    out.set(row.id, {
      id: row.id,
      fromMe: row.senderId === actorId,
      body: body.length > QUOTE_CHARS ? `${body.slice(0, QUOTE_CHARS - 1)}…` : body,
      available: true,
    });
  }
  // Anything that did not come back is gone: deleted, or never in this conversation. Same render either way.
  for (const id of unique) {
    if (!out.has(id)) out.set(id, { id, fromMe: false, body: null, available: false });
  }
  return out;
}

/** Rows → DTOs, with quotes and reactions resolved in two queries however long the page is. */
async function hydrateMessages(db: DbLike, actorId: string, conversationId: string, rows: readonly MessageRow[]): Promise<MessageDto[]> {
  if (rows.length === 0) return [];
  const [reactions, quotes] = await Promise.all([
    loadMessageReactions(db, actorId, rows.map((r) => r.id)),
    loadQuotes(db, actorId, conversationId, rows.flatMap((r) => (r.replyToMessageId ? [r.replyToMessageId] : []))),
  ]);
  return rows.map((m) => ({
    id: m.id,
    fromMe: m.senderId === actorId,
    kind: m.kind as MessageDto["kind"],
    body: m.body,
    at: m.createdAt.toISOString(),
    replyTo: m.replyToMessageId ? quotes.get(m.replyToMessageId) ?? null : null,
    editedAt: m.editedAt?.toISOString() ?? null,
    reactions: reactions.get(m.id) ?? EMPTY_REACTIONS,
  }));
}

/**
 * One message as the client renders it. Used by the send action, so the bubble that replaces an optimistic one is
 * built by exactly the same code that builds every other bubble — including its quote, which the sender cannot
 * assemble locally because a quote is resolved from the database, not carried in the request.
 *
 * Takes an already-authorised conversation id: the caller has just sent or edited within it.
 */
export async function getMessageDto(db: DbLike, actorId: string, conversationId: string, messageId: string): Promise<MessageDto | null> {
  const row = await db.message.findFirst({ where: { id: messageId, conversationId, deletedAt: null }, select: MESSAGE_SELECT });
  if (!row) return null;
  const [dto] = await hydrateMessages(db, actorId, conversationId, [row]);
  return dto ?? null;
}

/** History, newest first, cursor-paginated (bounded). */
export async function listMessages(actor: Actor, conversationId: string, options: { cursor?: string; limit?: number; db?: Db; now?: Date } = {}): Promise<MessagePageDto> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 100);
  const conversation = await getConversationForActor(db, actor, conversationId);
  const rows = await db.message.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: MESSAGE_SELECT,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // Paging backwards through history cannot change who has read what, so only the first page pays for it.
  const readState = options.cursor ? undefined : await getConversationReadState(db, actor.userId, conversationId, conversation.otherUserId);
  return {
    messages: await hydrateMessages(db, actor.userId, conversationId, page),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    serverNow: now.toISOString(),
    ...(readState ? { readState } : {}),
    interactionAt: conversation.interactionAt?.toISOString() ?? null,
  };
}

export interface PollDto {
  /** Messages newer than `afterId`, oldest first (bounded). */
  messages: MessageDto[];
  status: "ACTIVE" | "PENDING" | "LOCKED";
  serverNow: string;
  /** Carried on every poll: reading is a change the sender should see, even when nothing new was said. */
  readState: ConversationReadStateDto;
  /** The conversation's current watermark. The client stores it and sends it back next time. */
  interactionAt: string | null;
  /**
   * Messages the client ALREADY HOLDS whose state has changed — a reaction added, swapped or taken off, or an
   * edited body. Empty on the overwhelming majority of polls, because it is only built when the watermark the
   * client sent back differs from the one above.
   */
  updates: MessageDto[];
}

/** Incremental poll: only messages after the newest one the client holds. Realtime can replace this without touching the UI. */
export async function pollConversation(
  actor: Actor,
  conversationId: string,
  options: { afterId?: string | null; limit?: number; sinceInteractionAt?: string | null; db?: Db; now?: Date } = {},
): Promise<PollDto> {
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
    select: MESSAGE_SELECT,
  });

  /*
   * The cheap part of the deal: when nothing has been reacted to or edited since the client last looked, the
   * watermark is unchanged and this whole branch is skipped. Only a real change costs a second query, which is
   * why the poll can afford to run every four seconds.
   */
  const interactionAt = conversation.interactionAt?.toISOString() ?? null;
  let updates: MessageDto[] = [];
  if (interactionAt !== null && options.sinceInteractionAt !== interactionAt) {
    const newIds = new Set(rows.map((r) => r.id));
    const window = await db.message.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: INTERACTION_WINDOW,
      select: MESSAGE_SELECT,
    });
    // Messages already in `messages` are fresh by construction; sending them twice would only invite the client
    // to reconcile the same row against itself.
    updates = await hydrateMessages(db, actor.userId, conversationId, window.filter((m) => !newIds.has(m.id)));
  }

  const readState = await getConversationReadState(db, actor.userId, conversationId, conversation.otherUserId);
  return {
    messages: await hydrateMessages(db, actor.userId, conversationId, rows),
    status: conversation.status,
    serverNow: now.toISOString(),
    readState,
    interactionAt,
    updates,
  };
}

/**
 * Marks the conversation read up to its latest message and clears its MESSAGE and NEW_MATCH notifications. Only called when the
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
  /*
   * Opening the chat a match created is having seen that match, so its NEW_MATCH notification is read too — THIS
   * conversation's only, never another match's and never another type. Without it the row stayed unread until the
   * bell was opened, and the match-email sweep could still mail "you have a new match" about a chat the member had
   * already opened. The match itself and the read receipts above are untouched.
   */
  const clearedMatch = await db.notification.updateMany({
    where: { userId: actor.userId, type: "NEW_MATCH", conversationId, readAt: null },
    data: { readAt: now },
  });
  return { unreadCleared: hadUnread > 0 || cleared.count > 0 || clearedMatch.count > 0 };
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

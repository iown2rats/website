/**
 * Transactional matching (docs/ARCHITECTURE.md §8). Must run inside the like transaction.
 */
import type { Tx } from "@/lib/db";
import { sortPair } from "@/server/actor";
import { isBlockedEitherWay } from "@/server/safety/block";

export interface MatchOutcome {
  matched: boolean;
  matchId: string | null;
  conversationId: string | null;
  /** Super Like intros copied into the conversation by THIS call (0 on a repeat). For analytics only. */
  introsDelivered?: number;
}

/**
 * If `toUserId` has already liked `fromUserId`, creates the Match (idempotent via the unique sorted
 * pair) and its Conversation, converts any pending intro conversation, and notifies both users.
 * Callers hold the pair advisory lock (see src/server/locks.ts); the block check below therefore cannot
 * race a concurrent block, which takes the same lock before it writes.
 */
export async function createMatchIfMutual(tx: Tx, fromUserId: string, toUserId: string, now: Date): Promise<MatchOutcome> {
  if (await isBlockedEitherWay(tx, fromUserId, toUserId)) return { matched: false, matchId: null, conversationId: null };
  const reverse = await tx.like.findUnique({
    where: { fromUserId_toUserId: { fromUserId: toUserId, toUserId: fromUserId } },
    select: { id: true },
  });
  if (!reverse) return { matched: false, matchId: null, conversationId: null };

  const pair = sortPair(fromUserId, toUserId);

  // ON CONFLICT DO NOTHING on the unique (userAId, userBId) index resolves the race between two
  // simultaneous mutual likes: exactly one row exists afterwards, whichever transaction wins.
  await tx.$executeRaw`
    INSERT INTO "Match" (id, "userAId", "userBId", status, "createdAt")
    VALUES (${cuidLike()}, ${pair.userAId}, ${pair.userBId}, 'ACTIVE', ${now})
    ON CONFLICT ("userAId", "userBId") DO NOTHING
  `;
  const match = await tx.match.findUniqueOrThrow({ where: { userAId_userBId: pair }, select: { id: true, status: true } });
  if (match.status !== "ACTIVE") {
    // A previously unmatched/blocked pair: a new mutual like does not silently revive it here.
    return { matched: false, matchId: match.id, conversationId: null };
  }

  // Conversation: reuse a PENDING intro conversation if one exists, otherwise create.
  const existing = await tx.conversation.findUnique({ where: { userAId_userBId: pair }, select: { id: true, status: true } });
  let conversationId: string;
  if (existing) {
    conversationId = existing.id;
    if (existing.status !== "ACTIVE") {
      await tx.conversation.update({ where: { id: existing.id }, data: { status: "ACTIVE", matchId: match.id } });
    }
    await tx.conversationParticipant.createMany({
      data: [
        { conversationId, userId: pair.userAId },
        { conversationId, userId: pair.userBId },
      ],
      skipDuplicates: true,
    });
  } else {
    const created = await tx.conversation.create({
      data: {
        userAId: pair.userAId,
        userBId: pair.userBId,
        matchId: match.id,
        status: "ACTIVE",
        participants: { create: [{ userId: pair.userAId }, { userId: pair.userBId }] },
      },
      select: { id: true },
    });
    conversationId = created.id;
  }

  const introsDelivered = await deliverIntros(tx, pair, conversationId, now);

  // Notifications, respecting each user's settings. Deduplicated by (user, match).
  const settings = await tx.notificationSettings.findMany({
    where: { userId: { in: [pair.userAId, pair.userBId] } },
    select: { userId: true, matches: true },
  });
  const wants = (id: string) => settings.find((s) => s.userId === id)?.matches ?? true;
  const notifications = [
    { userId: pair.userAId, actorId: pair.userBId },
    { userId: pair.userBId, actorId: pair.userAId },
  ].filter((n) => wants(n.userId));
  for (const n of notifications) {
    const already = await tx.notification.findFirst({
      where: { userId: n.userId, type: "NEW_MATCH", conversationId },
      select: { id: true },
    });
    if (!already) {
      await tx.notification.create({
        data: { userId: n.userId, type: "NEW_MATCH", actorId: n.actorId, conversationId, createdAt: now },
      });
    }
  }

  return { matched: true, matchId: match.id, conversationId, introsDelivered };
}

/**
 * Super Like intros become the conversation's first messages, once (docs/ARCHITECTURE.md §12.20).
 *
 * Each pending intro between the pair — normally one, two if both Super Liked — is written as an INTRO message from
 * its author, dated when it was written, and the Intro is pointed at it. `Intro.messageId` is unique and only ever set
 * from null, so an intro can be delivered once and never again: a repeated like, a retry or a second pass through
 * this function finds nothing left to deliver. Callers hold the pair lock, so two transactions never race here.
 *
 * Deliberately NOT a MESSAGE notification, push or email. The match itself is announced (NEW_MATCH, its push and its
 * email) and the intro is what the recipient finds when they open that chat; a second alert for the same moment
 * would be the duplicate this feature must not create. It does count as unread in the chat, like any message.
 */
async function deliverIntros(tx: Tx, pair: { userAId: string; userBId: string }, conversationId: string, now: Date): Promise<number> {
  const intros = await tx.intro.findMany({
    where: {
      messageId: null,
      like: { is: { kind: "SUPER" } },
      OR: [
        { fromUserId: pair.userAId, toUserId: pair.userBId },
        { fromUserId: pair.userBId, toUserId: pair.userAId },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, fromUserId: true, body: true, createdAt: true },
  });
  let delivered = 0;
  for (const intro of intros) {
    const message = await tx.message.create({
      data: { conversationId, senderId: intro.fromUserId, kind: "INTRO", body: intro.body, createdAt: intro.createdAt },
      select: { id: true },
    });
    const claimed = await tx.intro.updateMany({ where: { id: intro.id, messageId: null }, data: { messageId: message.id } });
    if (claimed.count === 0) {
      // Unreachable under the pair lock; if it ever happened, the intro is already in a conversation.
      await tx.message.delete({ where: { id: message.id } });
      continue;
    }
    // The author has read their own words, as with any message they send.
    await tx.conversationParticipant.updateMany({ where: { conversationId, userId: intro.fromUserId }, data: { lastReadMessageId: message.id, lastReadAt: now } });
    delivered += 1;
  }
  if (delivered > 0) await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
  return delivered;
}

/** Prisma's cuid(2) default is applied by the client, not the database, so raw inserts supply an id. */
function cuidLike(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(23));
  let out = "m";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

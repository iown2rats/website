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

  return { matched: true, matchId: match.id, conversationId };
}

/** Prisma's cuid(2) default is applied by the client, not the database, so raw inserts supply an id. */
function cuidLike(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(23));
  let out = "m";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

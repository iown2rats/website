/**
 * Blocking (docs/ARCHITECTURE.md §10). Phase 6 ships the domain function so the like/match path can be proven
 * race-free against it; the Safety UI (report sheet, blocked-users settings) arrives in Phase 10.
 */
import { getDb, type Db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { sortPair, type Actor } from "@/server/actor";
import { dropFollowsBetween } from "@/server/community/follows";
import { lockPair } from "@/server/locks";

export interface BlockResult {
  created: boolean;
  /** An ACTIVE match that was closed by this block, if any. */
  closedMatchId: string | null;
}

/**
 * Inside one transaction under the pair lock: insert the Block (idempotent), set any ACTIVE match between the
 * pair to BLOCKED and its conversation to LOCKED, and remove the pair's pending likes/passes in both
 * directions so neither can resurface or match. No notification is created for the blocked user.
 */
export async function blockUser(actor: Actor, targetUserId: string, options: { now?: Date; db?: Db; source?: "MANUAL" | "REPORT" } = {}): Promise<BlockResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (targetUserId === actor.userId) throw new ValidationError("You cannot block yourself");
  const target = await db.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) throw new NotFoundError("Profile");

  return db.$transaction(async (tx) => {
    await lockPair(tx, actor.userId, targetUserId);
    const existing = await tx.block.findUnique({ where: { blockerId_blockedId: { blockerId: actor.userId, blockedId: targetUserId } }, select: { id: true } });
    if (!existing) await tx.block.create({ data: { blockerId: actor.userId, blockedId: targetUserId, source: options.source ?? "MANUAL", createdAt: now } });

    const pair = sortPair(actor.userId, targetUserId);
    const match = await tx.match.findUnique({ where: { userAId_userBId: pair }, select: { id: true, status: true } });
    let closedMatchId: string | null = null;
    if (match && match.status === "ACTIVE") {
      await tx.match.update({ where: { id: match.id }, data: { status: "BLOCKED" } });
      await tx.conversation.updateMany({ where: { matchId: match.id }, data: { status: "LOCKED" } });
      closedMatchId = match.id;
    }
    await tx.like.deleteMany({
      where: { OR: [{ fromUserId: actor.userId, toUserId: targetUserId }, { fromUserId: targetUserId, toUserId: actor.userId }] },
    });
    // A block is a clean break in Community too: any follow between the pair goes, in both directions. The feed
    // would hide the posts anyway (it applies the block predicate to Following like every other tab), but leaving
    // the row behind means the relationship silently resumes if the block is ever lifted.
    await dropFollowsBetween(tx, actor.userId, targetUserId);
    return { created: !existing, closedMatchId };
  });
}

export async function isBlockedEitherWay(db: Db | Parameters<Parameters<Db["$transaction"]>[0]>[0], a: string, b: string): Promise<boolean> {
  const row = await db.block.findFirst({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { id: true },
  });
  return Boolean(row);
}

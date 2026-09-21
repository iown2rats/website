/**
 * Private follows (owner decision, 2026-09-21; docs/ARCHITECTURE.md §14.2).
 *
 * Following is one-directional and INVISIBLE to the person followed. They are never notified, they cannot see who
 * follows them, and no follower count is exposed by any DTO. That is the whole design, not a phase-one shortcut:
 * on a dating app a visible follow is a way to tell someone they are being watched, which is the behaviour the
 * Community Guidelines call stalking (clause 14). The only thing a follow does is decide whose posts appear in the
 * follower's own Following tab.
 *
 * Blocking wins over following in both directions, and it is enforced at READ time as well as here — a follow row
 * that survives some future code path still cannot surface a blocked person's posts, because the feed applies the
 * same visibility SQL to the Following tab as to every other tab.
 */
import { getDb, type Db, type DbLike } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";

/** Can this viewer follow that member at all? Self, non-members and either direction of a block are refused. */
async function assertFollowable(db: DbLike, actor: Actor, targetId: string): Promise<void> {
  if (targetId === actor.userId) throw new ValidationError("You can't follow yourself.");
  const target = await db.user.findFirst({
    where: { id: targetId, accountType: "MEMBER", status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!target) throw new NotFoundError("Member");
  const blocked = await db.block.findFirst({
    where: { OR: [{ blockerId: actor.userId, blockedId: targetId }, { blockerId: targetId, blockedId: actor.userId }] },
    select: { id: true },
  });
  // The same refusal either way: telling someone "they blocked you" is itself information they did not share.
  if (blocked) throw new NotFoundError("Member");
}

/** Idempotent: following someone already followed is a no-op, not an error. */
export async function followMember(actor: Actor, targetId: string, deps: { db?: Db; now?: Date } = {}): Promise<{ following: true }> {
  const db = deps.db ?? getDb();
  await assertFollowable(db, actor, targetId);
  await db.communityFollow.upsert({
    where: { followerId_followingId: { followerId: actor.userId, followingId: targetId } },
    create: { followerId: actor.userId, followingId: targetId, createdAt: deps.now ?? new Date() },
    update: {},
  });
  return { following: true };
}

/** Idempotent in the other direction, and deliberately does NOT check blocks: unfollowing must always work. */
export async function unfollowMember(actor: Actor, targetId: string, deps: { db?: Db } = {}): Promise<{ following: false }> {
  const db = deps.db ?? getDb();
  await db.communityFollow
    .delete({ where: { followerId_followingId: { followerId: actor.userId, followingId: targetId } } })
    .catch(() => undefined);
  return { following: false };
}

export async function isFollowing(db: DbLike, actor: Actor, targetId: string): Promise<boolean> {
  const row = await db.communityFollow.findUnique({
    where: { followerId_followingId: { followerId: actor.userId, followingId: targetId } },
    select: { followerId: true },
  });
  return Boolean(row);
}

/** Who this viewer follows. Used by the Following feed and to mark follow state in suggestions. */
export async function followingIds(db: DbLike, viewerId: string): Promise<string[]> {
  const rows = await db.communityFollow.findMany({ where: { followerId: viewerId }, select: { followingId: true } });
  return rows.map((r) => r.followingId);
}

/**
 * How many people the viewer follows. Only ever about the VIEWER'S own list — there is no function here that
 * answers "how many people follow X", because nothing in the product is allowed to ask.
 */
export async function followingCount(db: DbLike, viewerId: string): Promise<number> {
  return db.communityFollow.count({ where: { followerId: viewerId } });
}

/** Blocking removes the relationship in both directions. Called from the block path so a block is a clean break. */
export async function dropFollowsBetween(db: DbLike, a: string, b: string): Promise<void> {
  await db.communityFollow.deleteMany({
    where: { OR: [{ followerId: a, followingId: b }, { followerId: b, followingId: a }] },
  });
}

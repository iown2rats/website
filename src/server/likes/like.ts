/**
 * Like / Pass / Undo (docs/ARCHITECTURE.md §8, §12.3, §12.7).
 */
import { PASS_TTL_MS, UNDO } from "@/config/product";
import { getDb, type Db, type Tx } from "@/lib/db";
import { EntitlementRequiredError, InvalidStateError, LikeLimitReachedError, NotFoundError, UndoUnavailableError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { canView } from "@/server/discovery/query";
import { getEntitlements } from "@/server/entitlements";
import { lockPair } from "@/server/locks";
import { createMatchIfMutual, type MatchOutcome } from "@/server/matching/match";
import { isBlockedEitherWay } from "@/server/safety/block";
import { consumeLocked, lockUsage } from "@/server/usage/usage-window";
import { assertMemberAccount } from "@/server/members/guard";

export interface LikeResult extends MatchOutcome {
  /** True when this call created the like; false when it already existed (idempotent). */
  created: boolean;
  likesRemaining: number;
  likesResetAt: Date;
}

export interface LikeOptions {
  now?: Date;
  db?: Db;
}

export interface PassOptions extends LikeOptions {
  /**
   * The pass was tapped on Likes You, on somebody who liked the actor: it is an informed "no" to that like, so the
   * like is marked dismissed and leaves Likes You (src/server/likes/eligibility.ts, THE DISMISSAL RULE). A Discover
   * pass never sets this — Discover does not say who has liked you, so a pass there says nothing about a like.
   */
  dismissIncomingLike?: boolean;
}

/**
 * Likes `targetUserId` on behalf of the actor.
 * Transaction: lock usage row → lazy reset → resolve limit → pair lock → block re-check → insert like
 * (idempotent) → consume → match check → LIKE_RECEIVED notification. See §12.11 for why concurrent calls
 * cannot exceed the limit, and src/server/locks.ts for why a block cannot race a like into a match.
 */
export async function likeUser(actor: Actor, targetUserId: string, options: LikeOptions = {}): Promise<LikeResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (targetUserId === actor.userId) throw new ValidationError("You cannot like yourself");
  await assertMemberAccount(db, actor.userId);
  // Pause Dating (Phase 9 §24): a paused user is hidden from Discover and may not start new dating interactions,
  // otherwise pausing would grant Invisible Mode for free. Matches and chats are unaffected.
  const privacy = await db.privacySettings.findUnique({ where: { userId: actor.userId }, select: { visibility: true, pausedAt: true } });
  if (privacy?.visibility === "HIDDEN" || privacy?.pausedAt) throw new InvalidStateError("Dating is paused. Resume it in Privacy & Safety to like people.");

  // Visibility is checked before entering the transaction; it never depends on the counter.
  if (!(await canView(db, actor.userId, targetUserId, now))) throw new NotFoundError("Profile");

  return db.$transaction(async (tx) => {
    const locked = await lockUsage(tx, actor.userId, "LIKES", now);
    const entitlements = await getEntitlements(tx, actor.userId, now);
    const limit = entitlements.rules.dailyLikeLimit;

    // Serialise against blockUser() for this pair, then re-check: the pre-transaction visibility check may be stale.
    await lockPair(tx, actor.userId, targetUserId);
    if (await isBlockedEitherWay(tx, actor.userId, targetUserId)) throw new NotFoundError("Profile");
    // Dating and Friendship are separate pools for new interactions too, not only in the deck: a handle reached
    // any other way (a stale Likes You tile, a crafted request) cannot start one across them. Read inside the
    // transaction, so a pool switch that has already committed is what counts. Existing likes and matches are
    // never touched by a later switch — this only refuses a new like.
    if (!(await sharePool(tx, actor.userId, targetUserId))) throw new InvalidStateError(CROSS_POOL_LIKE);

    const existing = await tx.like.findUnique({
      where: { fromUserId_toUserId: { fromUserId: actor.userId, toUserId: targetUserId } },
      select: { id: true },
    });
    if (existing) {
      // Idempotent: an existing like consumes nothing and re-reports the current match state.
      const outcome = await createMatchIfMutual(tx, actor.userId, targetUserId, now);
      return {
        ...outcome,
        created: false,
        likesRemaining: Math.max(0, limit - locked.used),
        likesResetAt: locked.windowEnd,
      };
    }

    const consumed = await consumeLocked(tx, actor.userId, "LIKES", locked, limit, now);
    if (!consumed.ok) throw new LikeLimitReachedError(limit, consumed.windowEnd);

    await tx.like.create({ data: { fromUserId: actor.userId, toUserId: targetUserId, createdAt: now } });
    // Any active pass on this target is superseded by the like.
    await tx.pass.updateMany({
      where: { fromUserId: actor.userId, toUserId: targetUserId, undoneAt: null },
      data: { undoneAt: now },
    });

    const outcome = await createMatchIfMutual(tx, actor.userId, targetUserId, now);
    if (!outcome.matched) await notifyLikeReceived(tx, actor.userId, targetUserId, now);
    return {
      ...outcome,
      created: true,
      likesRemaining: Math.max(0, limit - consumed.used),
      likesResetAt: consumed.windowEnd,
    };
  });
}

/** Deliberately neutral: it does not say which pool the other person is in (docs/ARCHITECTURE.md §7.5). */
export const CROSS_POOL_LIKE = "This profile isn't available to like right now.";

/** Are both members here for the same thing (Dating or Friendship)? A missing row reads as the column default, DATING. */
async function sharePool(tx: Tx, a: string, b: string): Promise<boolean> {
  const rows = await tx.discoveryPreferences.findMany({ where: { userId: { in: [a, b] } }, select: { userId: true, connectionIntent: true } });
  const pool = (id: string) => rows.find((r) => r.userId === id)?.connectionIntent ?? "DATING";
  return pool(a) === pool(b);
}

/** One LIKE_RECEIVED notification per liker, honouring the recipient's notification settings. */
async function notifyLikeReceived(tx: Tx, fromUserId: string, toUserId: string, now: Date): Promise<void> {
  const settings = await tx.notificationSettings.findUnique({ where: { userId: toUserId }, select: { likes: true } });
  if (settings && !settings.likes) return;
  const already = await tx.notification.findFirst({ where: { userId: toUserId, type: "LIKE_RECEIVED", actorId: fromUserId }, select: { id: true } });
  if (!already) await tx.notification.create({ data: { userId: toUserId, type: "LIKE_RECEIVED", actorId: fromUserId, createdAt: now } });
}

/**
 * Passes never consume the like allowance. Idempotent; re-passing refreshes the 30-day window. With
 * `dismissIncomingLike` (Likes You only) the target's like on the actor is dismissed in the same transaction; it is a
 * no-op when there is no such like, and it never touches the actor's own likes or anybody else's.
 */
export async function passUser(actor: Actor, targetUserId: string, options: PassOptions = {}): Promise<{ created: boolean }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (targetUserId === actor.userId) throw new ValidationError("You cannot pass yourself");
  await assertMemberAccount(db, actor.userId);
  const target = await db.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) throw new NotFoundError("Profile");

  const expiresAt = new Date(now.getTime() + PASS_TTL_MS);
  return db.$transaction(async (tx) => {
    if (options.dismissIncomingLike) {
      await tx.like.updateMany({ where: { fromUserId: targetUserId, toUserId: actor.userId, dismissedAt: null }, data: { dismissedAt: now } });
    }
    const existing = await tx.pass.findUnique({
      where: { fromUserId_toUserId: { fromUserId: actor.userId, toUserId: targetUserId } },
      select: { id: true },
    });
    if (existing) {
      await tx.pass.update({ where: { id: existing.id }, data: { createdAt: now, expiresAt, undoneAt: null } });
      return { created: false };
    }
    await tx.pass.create({ data: { fromUserId: actor.userId, toUserId: targetUserId, createdAt: now, expiresAt } });
    return { created: true };
  });
}

export interface UndoResult {
  restoredUserId: string;
}

/**
 * Undo (Plus): reverses the actor's most recent Pass if it is still eligible — it is their most recent
 * swipe action, has not been undone already, and (only if UNDO.maxAgeMs is set) is young enough.
 * Records `undoneAt`; deletes nothing. No arbitrary historical undo.
 */
export async function undoLastPass(actor: Actor, options: LikeOptions = {}): Promise<UndoResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  return db.$transaction(async (tx) => {
    const entitlements = await getEntitlements(tx, actor.userId, now);
    if (!entitlements.rules.canUndoPass) throw new EntitlementRequiredError("Undo");

    // Lock the most recent pass (undone or not) so two concurrent undos cannot both succeed and an
    // already-undone latest action cannot expose the one before it.
    const rows = await tx.$queryRaw<{ id: string; toUserId: string; createdAt: Date; undoneAt: Date | null }[]>`
      SELECT id, "toUserId", "createdAt", "undoneAt" FROM "Pass"
      WHERE "fromUserId" = ${actor.userId}
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `;
    const last = rows[0];
    if (!last) throw new UndoUnavailableError("Nothing to undo");
    if (last.undoneAt) throw new UndoUnavailableError("Your most recent pass has already been undone");
    if (UNDO.maxAgeMs !== null && now.getTime() - last.createdAt.getTime() > UNDO.maxAgeMs) {
      throw new UndoUnavailableError("That pass is too old to undo");
    }

    const laterLike = await tx.like.findFirst({
      where: { fromUserId: actor.userId, createdAt: { gt: last.createdAt } },
      select: { id: true },
    });
    if (laterLike) throw new UndoUnavailableError("Only your most recent action can be undone");

    await tx.pass.update({ where: { id: last.id }, data: { undoneAt: now } });
    return { restoredUserId: last.toUserId };
  });
}

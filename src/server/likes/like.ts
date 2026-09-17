/**
 * Like / Pass / Undo (docs/ARCHITECTURE.md §8, §12.3, §12.7).
 */
import { PASS_TTL_MS, UNDO } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { EntitlementRequiredError, LikeLimitReachedError, NotFoundError, UndoUnavailableError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { canView } from "@/server/discovery/query";
import { getEntitlements } from "@/server/entitlements";
import { createMatchIfMutual, type MatchOutcome } from "@/server/matching/match";
import { consumeLocked, lockUsage } from "@/server/usage/usage-window";

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

/**
 * Likes `targetUserId` on behalf of the actor.
 * Transaction: lock usage row → lazy reset → resolve limit → reject if exhausted → insert like
 * (idempotent) → consume → match check. See §12.11 for why concurrent calls cannot exceed the limit.
 */
export async function likeUser(actor: Actor, targetUserId: string, options: LikeOptions = {}): Promise<LikeResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (targetUserId === actor.userId) throw new ValidationError("You cannot like yourself");

  // Visibility is checked before entering the transaction; it never depends on the counter.
  if (!(await canView(db, actor.userId, targetUserId, now))) throw new NotFoundError("Profile");

  return db.$transaction(async (tx) => {
    const locked = await lockUsage(tx, actor.userId, "LIKES", now);
    const entitlements = await getEntitlements(tx, actor.userId, now);
    const limit = entitlements.rules.dailyLikeLimit;

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
    return {
      ...outcome,
      created: true,
      likesRemaining: Math.max(0, limit - consumed.used),
      likesResetAt: consumed.windowEnd,
    };
  });
}

/** Passes never consume the like allowance. Idempotent; re-passing refreshes the 30-day window. */
export async function passUser(actor: Actor, targetUserId: string, options: LikeOptions = {}): Promise<{ created: boolean }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (targetUserId === actor.userId) throw new ValidationError("You cannot pass yourself");
  const target = await db.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) throw new NotFoundError("Profile");

  const expiresAt = new Date(now.getTime() + PASS_TTL_MS);
  const existing = await db.pass.findUnique({
    where: { fromUserId_toUserId: { fromUserId: actor.userId, toUserId: targetUserId } },
    select: { id: true },
  });
  if (existing) {
    await db.pass.update({ where: { id: existing.id }, data: { createdAt: now, expiresAt, undoneAt: null } });
    return { created: false };
  }
  await db.pass.create({ data: { fromUserId: actor.userId, toUserId: targetUserId, createdAt: now, expiresAt } });
  return { created: true };
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

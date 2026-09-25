/**
 * Like / Pass / Undo (docs/ARCHITECTURE.md §8, §12.3, §12.7).
 */
import { PASS_TTL_MS, SUPER_LIKE, UNDO } from "@/config/product";
import { getDb, type Db, type Tx } from "@/lib/db";
import { EntitlementRequiredError, InvalidStateError, LikeLimitReachedError, NotFoundError, SuperLikeLimitReachedError, UndoUnavailableError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { canView } from "@/server/discovery/query";
import { getEntitlements } from "@/server/entitlements";
import { lockPair } from "@/server/locks";
import { normalizeMessageBody } from "@/server/conversations/messages";
import { createMatchIfMutual, type MatchOutcome } from "@/server/matching/match";
import { isBlockedEitherWay } from "@/server/safety/block";
import { consumeLocked, lockUsage } from "@/server/usage/usage-window";
import { assertMemberAccount } from "@/server/members/guard";

export interface LikeResult extends MatchOutcome {
  /** True when this call created the like; false when it already existed (idempotent). */
  created: boolean;
  /** Remaining in the allowance this call used: daily likes for a like, the 7-day window for a Super Like. */
  likesRemaining: number;
  likesResetAt: Date;
  kind: "NORMAL" | "SUPER";
}

export interface LikeOptions {
  now?: Date;
  db?: Db;
}

export interface SuperLikeOptions extends LikeOptions {
  /** Optional. Trimmed; empty or whitespace-only means no message. At most SUPER_LIKE.messageMaxLength characters. */
  message?: string | null;
}

/** Why a Super Like to somebody already liked is refused rather than "upgraded" (docs/ARCHITECTURE.md §12.20). */
export const ALREADY_LIKED = "You've already liked them.";

/**
 * The Super Like message as it will be stored, or null for none. Same cleaning as a chat message (line endings
 * normalised, control characters other than newline and tab removed, trimmed); length is counted in code points, so
 * an emoji is one character, as a person counts it. The text is stored as text and always rendered as text — React
 * escapes it — so markup in it is inert rather than rejected.
 */
export function normalizeSuperLikeMessage(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const body = normalizeMessageBody(raw);
  if (body.length === 0) return null;
  if ([...body].length > SUPER_LIKE.messageMaxLength) throw new ValidationError(`Your message can be up to ${SUPER_LIKE.messageMaxLength} characters.`);
  return body;
}

/**
 * Super Like (Plus): a like of kind SUPER, with an optional message, spending one of the 5-per-7-days allowance.
 * It is `likeUser` — same visibility, block, pool, pause, staff and matching rules — with a different allowance;
 * see there. Retrying a Super Like that already succeeded returns the same outcome and spends nothing.
 */
export async function superLikeUser(actor: Actor, targetUserId: string, options: SuperLikeOptions = {}): Promise<LikeResult> {
  const message = normalizeSuperLikeMessage(options.message);
  return likeUserInternal(actor, targetUserId, { ...options, superLike: { message } });
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
  return likeUserInternal(actor, targetUserId, options);
}

/**
 * The one like path, for both kinds. A Super Like differs in exactly three places, all inside the transaction:
 * which allowance row is locked and spent (SUPER_LIKES, 7 days, 0 without Plus — checked here from the entitlement,
 * never from the client), what an existing like to the same person means (see below), and what is written (kind SUPER
 * plus the optional Intro). Everything that decides WHETHER a like may happen is shared, so a Super Like can never be
 * a way round a block, a pool, Invisible Mode, a pause or staff isolation.
 *
 * An existing like to the same person: for a like, the call is idempotent as it always was. For a Super Like, an
 * existing SUPER like is the same idempotent success (a retry, a double tap, a second tab — nothing is spent twice),
 * and an existing NORMAL like is refused with nothing spent: one Like row per pair, never a second record and never
 * a silent "upgrade" of a pending like into a louder one.
 */
async function likeUserInternal(actor: Actor, targetUserId: string, options: LikeOptions & { superLike?: { message: string | null } }): Promise<LikeResult> {
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

  const isSuper = options.superLike != null;
  const allowanceKind = isSuper ? "SUPER_LIKES" : "LIKES";
  return db.$transaction(async (tx) => {
    // Lock order is always usage row, then pair (src/server/locks.ts). Concurrent Super Likes by one member queue on
    // this row, so five-per-window holds however many tabs, devices or retries are in flight.
    const locked = await lockUsage(tx, actor.userId, allowanceKind, now);
    const entitlements = await getEntitlements(tx, actor.userId, now);
    const limit = isSuper ? entitlements.rules.superLikesPerWindow : entitlements.rules.dailyLikeLimit;
    // Read inside the transaction: a Plus that lapsed while the composer was open is Free here.
    if (isSuper && limit === 0) throw new EntitlementRequiredError("Super Like");

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
      select: { id: true, kind: true },
    });
    if (existing) {
      if (isSuper && existing.kind !== "SUPER") throw new InvalidStateError(ALREADY_LIKED);
      // Idempotent: an existing like consumes nothing and re-reports the current match state.
      const outcome = await createMatchIfMutual(tx, actor.userId, targetUserId, now);
      return {
        ...outcome,
        created: false,
        likesRemaining: Math.max(0, limit - locked.used),
        likesResetAt: locked.windowEnd,
        kind: existing.kind,
      };
    }

    const consumed = await consumeLocked(tx, actor.userId, allowanceKind, locked, limit, now);
    if (!consumed.ok) throw isSuper ? new SuperLikeLimitReachedError(limit, consumed.windowEnd) : new LikeLimitReachedError(limit, consumed.windowEnd);

    // The message belongs to the Super Like until a match, when createMatchIfMutual copies it into the conversation.
    const message = options.superLike?.message ?? null;
    const intro = message
      ? await tx.intro.create({ data: { fromUserId: actor.userId, toUserId: targetUserId, body: message, weekKey: isoWeekKey(now), createdAt: now }, select: { id: true } })
      : null;
    await tx.like.create({ data: { fromUserId: actor.userId, toUserId: targetUserId, createdAt: now, kind: isSuper ? "SUPER" : "NORMAL", introId: intro?.id ?? null } });
    // Any active pass on this target is superseded by the like.
    await tx.pass.updateMany({
      where: { fromUserId: actor.userId, toUserId: targetUserId, undoneAt: null },
      data: { undoneAt: now },
    });

    const outcome = await createMatchIfMutual(tx, actor.userId, targetUserId, now);
    if (!outcome.matched) await notifyLikeReceived(tx, actor.userId, targetUserId, now, isSuper ? { superLike: true, withMessage: message != null } : null);
    return {
      ...outcome,
      created: true,
      likesRemaining: Math.max(0, limit - consumed.used),
      likesResetAt: consumed.windowEnd,
      kind: isSuper ? "SUPER" : "NORMAL",
    };
  });
}

/** ISO-8601 week key ("2026-W39"), kept on Intro.weekKey for the record. It is not the allowance: that is UsageCounter. */
function isoWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Deliberately neutral: it does not say which pool the other person is in (docs/ARCHITECTURE.md §7.5). */
export const CROSS_POOL_LIKE = "This profile isn't available to like right now.";

/** Are both members here for the same thing (Dating or Friendship)? A missing row reads as the column default, DATING. */
async function sharePool(tx: Tx, a: string, b: string): Promise<boolean> {
  const rows = await tx.discoveryPreferences.findMany({ where: { userId: { in: [a, b] } }, select: { userId: true, connectionIntent: true } });
  const pool = (id: string) => rows.find((r) => r.userId === id)?.connectionIntent ?? "DATING";
  return pool(a) === pool(b);
}

/**
 * One LIKE_RECEIVED notification per liker, honouring the recipient's notification settings. A Super Like is the same
 * row with `data: { superLike: true, withMessage }` — two booleans, never the message text — so every existing path
 * (the bell, the badge, Likes You's "seen", push, the digest) already handles it, and a person can never be alerted
 * twice about one like. The copy is decided where the row is read (feed, push), with the usual rules on naming.
 */
async function notifyLikeReceived(tx: Tx, fromUserId: string, toUserId: string, now: Date, data: { superLike: true; withMessage: boolean } | null): Promise<void> {
  const settings = await tx.notificationSettings.findUnique({ where: { userId: toUserId }, select: { likes: true } });
  if (settings && !settings.likes) return;
  const already = await tx.notification.findFirst({ where: { userId: toUserId, type: "LIKE_RECEIVED", actorId: fromUserId }, select: { id: true } });
  if (!already) await tx.notification.create({ data: { userId: toUserId, type: "LIKE_RECEIVED", actorId: fromUserId, createdAt: now, ...(data ? { data } : {}) } });
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

/**
 * "You have a new match" and "you have N new likes" (docs/ARCHITECTURE.md §12.16b, §12.16c).
 *
 * The same shape as the message email next door, deliberately: presence decides, the unread notification row is
 * the queue, a RateLimitBucket key is the idempotency, and nothing here may throw into a caller. What differs is
 * only what each one is FOR.
 *
 * A MATCH is a single event, so it behaves like the message email: an immediate send when the other person is
 * away, and a sweep for the one case the send path cannot see — they were in the app when it happened and left
 * without opening it.
 *
 * LIKES ARE NOT. They arrive in bursts, from people the recipient may not be allowed to know about, and an email
 * per like would be the most annoying notification this product could ship. So likes are a DIGEST: at most one a
 * day, counting the eligible likes that are new since the last one, sent only to somebody who is away and has been
 * for long enough that the count has settled. It names nobody — see `newLikesEmail` for why that holds even for Plus members.
 *
 * NEITHER CREATES A NOTIFICATION. Both read the rows the in-app feed already writes, so a member who has matches
 * or likes switched off has no rows, and therefore no email, without this file knowing anything about it.
 */
import { Prisma } from "@/generated/prisma/client";
import { LIKE_EMAIL, MATCH_EMAIL } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { getEmailProvider } from "@/lib/email";
import { newLikesEmail, newMatchEmail } from "@/lib/email/templates";
import { emailDeliveryConfigured, getEnv } from "@/lib/env";
import { claimOnce, consumeRateLimit } from "@/server/auth/rate-limit";
import { listEligibleIncomingLikes } from "@/server/likes/eligibility";
import { isMemberPresent, isPresent } from "@/server/presence";
import { logEmailOutcome, resolveEmailRecipient, warnEmailUnconfigured } from "./email-recipient";

export type DeliveryOutcome = "sent" | "no-address" | "notifications-off" | "throttled" | "failed";
export type MatchOutcome = DeliveryOutcome | "present" | "not-configured" | "no-match";
export type LikeDigestOutcome = DeliveryOutcome | "present" | "not-configured" | "too-few";

// ───────────────────────────────── Matches ─────────────────────────────────

/**
 * Sends one match email, or says why it did not. Presence is the CALLER's question, as it is for messages: both
 * callers have already established the recipient is away, and re-checking here would hide which path decided.
 */
async function deliverMatchEmail(db: DbLike, input: { recipientId: string; conversationId: string; now: Date }): Promise<MatchOutcome> {
  const recipient = await resolveEmailRecipient(db, input.recipientId, "matches");
  if (!recipient.ok) {
    logEmailOutcome("match", recipient.reason, input.recipientId);
    return recipient.reason;
  }

  /*
   * The NEW_MATCH row must exist. It is written inside the matching transaction, one per (member, conversation),
   * and it is absent when the member has matches switched off — so this is both the "is there anything to say"
   * check and a second, independent guard on the preference.
   */
  const notification = await db.notification.findFirst({
    where: { userId: input.recipientId, type: "NEW_MATCH", conversationId: input.conversationId },
    select: { id: true, readAt: true },
  });
  if (!notification) return "no-match";
  // Already opened in the app. Emailing now would be telling somebody something they already know.
  if (notification.readAt !== null) return "no-match";

  /*
   * Claimed before sending, so a provider failure cannot become a retry storm against a struggling provider.
   *
   * ONCE PER MATCH, EVER. This used to be a one-per-week windowed limit, and the windows are epoch-aligned: a match
   * emailed on Wednesday was eligible again at Thursday 00:00 UTC, and the sweep — which keeps unread matches for
   * three days — sent it again. A claim has no window. Keys the old limit already consumed count as claimed, so
   * nothing emailed before this change can be emailed a second time because of it.
   */
  if (!(await claimOnce(db, `email:match:${input.recipientId}:${input.conversationId}`))) return "throttled";

  const message = newMatchEmail(`${getEnv().APP_URL}/chats/${input.conversationId}`);
  try {
    await getEmailProvider().send({ to: recipient.address, ...message });
    return "sent";
  } catch {
    logEmailOutcome("match", "failed", input.recipientId);
    return "failed";
  }
}

/** The send path: email the new match straight away when they are not in the app. */
export async function notifyAwayMatch(
  input: { recipientId: string; conversationId: string },
  options: { db?: Db; now?: Date } = {},
): Promise<MatchOutcome> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!emailDeliveryConfigured()) {
    warnEmailUnconfigured("match emails");
    return "not-configured";
  }
  if (await isMemberPresent(db, input.recipientId, now)) return "present";
  return deliverMatchEmail(db, { ...input, now });
}

/** Fire-and-forget for request paths: never awaited, never rejects. */
export function kickMatchEmail(input: { recipientId: string; conversationId: string }, options: { db?: Db; now?: Date } = {}): void {
  void notifyAwayMatch(input, options).catch(() => {});
}

export interface SweepResult {
  sent: number;
  /** Candidates passed over: present, throttled, no address, notifications off, already read. */
  skipped: number;
  throttled: boolean;
}

/**
 * The safety net: people who were in the app when they matched — which is most of them, since one of the two just
 * swiped — and who have since gone away without opening it.
 */
export async function sweepMatchEmails(options: { db?: Db; now?: Date; force?: boolean } = {}): Promise<SweepResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!emailDeliveryConfigured()) {
    warnEmailUnconfigured("match emails");
    return { sent: 0, skipped: 0, throttled: false };
  }
  if (!options.force) {
    const gate = await consumeRateLimit(db, "email:match:sweep", 1, MATCH_EMAIL.sweepEveryMs, now);
    if (!gate.allowed) return { sent: 0, skipped: 0, throttled: true };
  }

  const candidates = await db.notification.findMany({
    where: {
      type: "NEW_MATCH",
      readAt: null,
      createdAt: { gt: new Date(now.getTime() - MATCH_EMAIL.giveUpAfterMs) },
      conversationId: { not: null },
      user: { status: "ACTIVE", deletedAt: null, accountType: "MEMBER" },
    },
    orderBy: { createdAt: "asc" },
    take: MATCH_EMAIL.batchSize,
    select: { userId: true, conversationId: true, user: { select: { lastActiveAt: true } } },
  });

  let sent = 0;
  let skipped = 0;
  for (const row of candidates) {
    if (!row.conversationId) continue;
    // Never mail somebody who is in the app, whatever the match's age. That is the whole rule.
    if (isPresent(row.user.lastActiveAt, now)) {
      skipped++;
      continue;
    }
    const outcome = await deliverMatchEmail(db, { recipientId: row.userId, conversationId: row.conversationId, now });
    if (outcome === "sent") sent++;
    else skipped++;
  }
  return { sent, skipped, throttled: false };
}

// ─────────────────────────────── Likes digest ───────────────────────────────

/*
 * WHAT A DIGEST REPORTS. "You have N new likes" must mean exactly that:
 *
 *   - ELIGIBLE likes, by the same rule Likes You runs (src/server/likes/eligibility.ts). A like from somebody the
 *     member has since blocked, matched or dismissed on Likes You is not on that page, so it is not in the number
 *     either (a Discover pass hides nothing there, so it hides nothing here);
 *   - NEW since the previous digest. The digest used to count every unread LIKE_RECEIVED row, so the same likes
 *     were re-announced every day for a week. Now a like is reported once;
 *   - still UNREAD in the feed. The notification row is kept as a guard, not as the count: it carries the Likes
 *     preference (no row when likes are switched off) and "already seen in the bell".
 *
 * WHEN THE LAST DIGEST WENT. Each send appends a RateLimitBucket row keyed `email:likes:digest:<member>` whose
 * `windowStart` is the moment it was sent — a log, not a limit, and it needs no new table. Digests sent before this
 * change left only a daily bucket (`email:likes:<member>`, windowStart = that UTC day's midnight) and not the time
 * itself, so those are read as having gone at the END of their day: the conservative reading, which can only err
 * towards not re-announcing a like. No historical row is changed.
 */
const DIGEST_LOG_PREFIX = "email:likes:digest:";
const LEGACY_DIGEST_PREFIX = "email:likes:";

/** The SQL for "when did this member's last digest go", for a member-id expression. NULL when never. */
function lastDigestSql(memberId: Prisma.Sql, now: Date): Prisma.Sql {
  return Prisma.sql`GREATEST(
    (SELECT max(b."windowStart") FROM "RateLimitBucket" b WHERE b.key = ${DIGEST_LOG_PREFIX}::text || (${memberId})::text),
    -- CASE, not a bare LEAST: LEAST ignores NULL, so "never sent" would otherwise read as "sent just now".
    (SELECT CASE WHEN max(b."windowStart") IS NULL THEN NULL
                 ELSE LEAST(max(b."windowStart") + (${LIKE_EMAIL.digestEveryMs}::double precision * interval '1 millisecond'), ${now}::timestamp) END
       FROM "RateLimitBucket" b WHERE b.key = ${LEGACY_DIGEST_PREFIX}::text || (${memberId})::text)
  )`;
}

async function lastDigestAt(db: DbLike, recipientId: string, now: Date): Promise<Date | null> {
  const rows = await db.$queryRaw<{ at: Date | null }[]>(Prisma.sql`SELECT ${lastDigestSql(Prisma.sql`${recipientId}`, now)} AS at`);
  return rows[0]?.at ?? null;
}

/**
 * Counts the likes worth telling somebody about: eligible, unread, settled, new since the last digest, and not so
 * old that the moment has passed.
 */
async function countDigestLikes(db: DbLike, recipientId: string, now: Date, since: Date | null): Promise<number> {
  const giveUp = new Date(now.getTime() - LIKE_EMAIL.giveUpAfterMs);
  const floor = since && since > giveUp ? since : giveUp;
  const unread = await db.notification.findMany({
    where: { userId: recipientId, type: "LIKE_RECEIVED", readAt: null, actorId: { not: null } },
    select: { actorId: true },
  });
  const likerIds = [...new Set(unread.flatMap((n) => (n.actorId ? [n.actorId] : [])))];
  if (likerIds.length === 0) return 0;
  const eligible = await listEligibleIncomingLikes(db, recipientId, now, {
    onlyLikerIds: likerIds,
    likedAfter: floor,
    likedBefore: new Date(now.getTime() - LIKE_EMAIL.unreadForMs),
  });
  return eligible.length;
}

/**
 * Records that a digest is going, or says it may not. Serialised per member with an advisory lock, so two sweeps
 * racing on one member cannot both pass the once-a-day check.
 */
async function claimDigest(db: DbLike, recipientId: string, now: Date): Promise<boolean> {
  const run = async (tx: DbLike) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DIGEST_LOG_PREFIX + recipientId}))`;
    const last = await lastDigestAt(tx, recipientId, now);
    if (last && now.getTime() - last.getTime() < LIKE_EMAIL.digestEveryMs) return false;
    await tx.$executeRaw`
      INSERT INTO "RateLimitBucket" (key, "windowStart", count) VALUES (${DIGEST_LOG_PREFIX + recipientId}, ${now}, 1)
      ON CONFLICT (key, "windowStart") DO NOTHING
    `;
    return true;
  };
  return "$transaction" in db ? (db as Db).$transaction((tx) => run(tx)) : run(db);
}

/** Sends one digest, or says why it did not. The caller has already established the recipient is away. */
async function deliverLikeDigest(db: DbLike, input: { recipientId: string; now: Date }): Promise<LikeDigestOutcome> {
  const recipient = await resolveEmailRecipient(db, input.recipientId, "likes");
  if (!recipient.ok) {
    logEmailOutcome("likes", recipient.reason, input.recipientId);
    return recipient.reason;
  }

  // At most one a day, measured from the last one actually sent — not from a calendar day, which reset at
  // midnight UTC and let a digest go at 23:59 and again at 00:01.
  const since = await lastDigestAt(db, input.recipientId, input.now);
  if (since && input.now.getTime() - since.getTime() < LIKE_EMAIL.digestEveryMs) return "throttled";

  const count = await countDigestLikes(db, input.recipientId, input.now, since);
  if (count < LIKE_EMAIL.minLikes) return "too-few";

  // Taken BEFORE sending and keyed on the member alone, so a provider failure cannot become a retry storm.
  if (!(await claimDigest(db, input.recipientId, input.now))) return "throttled";

  // The count, and a way back. Never a name, never a photo, never a handle — see newLikesEmail.
  const message = newLikesEmail(count, `${getEnv().APP_URL}/likes`);
  try {
    await getEmailProvider().send({ to: recipient.address, ...message });
    return "sent";
  } catch {
    logEmailOutcome("likes", "failed", input.recipientId);
    return "failed";
  }
}

/**
 * Digest entry point for one member. Exported for tests and for any future scheduled caller; the sweep below is
 * what actually drives it in production, because a digest has no moment in a request to hang off.
 */
export async function sendLikeDigest(recipientId: string, options: { db?: Db; now?: Date } = {}): Promise<LikeDigestOutcome> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!emailDeliveryConfigured()) {
    warnEmailUnconfigured("like digests");
    return "not-configured";
  }
  if (await isMemberPresent(db, recipientId, now)) return "present";
  return deliverLikeDigest(db, { recipientId, now });
}

/**
 * The digest sweep. Finds members with settled unread likes who are away, and sends each at most one email a day.
 *
 * Grouping first, then one delivery per member, is what makes this a digest rather than a loop over likes: twenty
 * likes for one person is one candidate, not twenty.
 */
export async function sweepLikeDigests(options: { db?: Db; now?: Date; force?: boolean } = {}): Promise<SweepResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!emailDeliveryConfigured()) {
    warnEmailUnconfigured("like digests");
    return { sent: 0, skipped: 0, throttled: false };
  }
  if (!options.force) {
    const gate = await consumeRateLimit(db, "email:likes:sweep", 1, LIKE_EMAIL.sweepEveryMs, now);
    if (!gate.allowed) return { sent: 0, skipped: 0, throttled: true };
  }

  /*
   * Members with unread likes that arrived after their last digest, and whose last digest is more than a day old.
   * This is only a cheap pre-filter — eligibility is decided per member in `countDigestLikes` — but it keeps members
   * whose likes were already reported out of the batch, rather than re-checking them every minute for a week.
   */
  const candidates = await db.$queryRaw<{ userId: string; lastActiveAt: Date | null }[]>(Prisma.sql`
    WITH cand AS (
      SELECT n."userId", u."lastActiveAt", min(n."createdAt") AS first_at, max(n."createdAt") AS last_at
      FROM "Notification" n
      JOIN "User" u ON u.id = n."userId"
      WHERE n.type = 'LIKE_RECEIVED' AND n."readAt" IS NULL
        AND n."createdAt" < ${new Date(now.getTime() - LIKE_EMAIL.unreadForMs)}
        AND n."createdAt" > ${new Date(now.getTime() - LIKE_EMAIL.giveUpAfterMs)}
        AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL AND u."accountType" = 'MEMBER'
      GROUP BY n."userId", u."lastActiveAt"
    ), digested AS (
      SELECT c.*, ${lastDigestSql(Prisma.sql`c."userId"`, now)} AS digested_at FROM cand c
    )
    SELECT "userId", "lastActiveAt" FROM digested
    WHERE digested_at IS NULL OR (digested_at <= ${new Date(now.getTime() - LIKE_EMAIL.digestEveryMs)} AND last_at > digested_at)
    ORDER BY first_at ASC
    LIMIT ${LIKE_EMAIL.batchSize}
  `);
  const lastActive = new Map(candidates.map((c) => [c.userId, c.lastActiveAt]));

  let sent = 0;
  let skipped = 0;
  for (const row of candidates) {
    // Never mail somebody who is in the app, however many likes are waiting. That is the whole rule.
    if (isPresent(lastActive.get(row.userId) ?? null, now)) {
      skipped++;
      continue;
    }
    const outcome = await deliverLikeDigest(db, { recipientId: row.userId, now });
    if (outcome === "sent") sent++;
    else skipped++;
  }
  return { sent, skipped, throttled: false };
}

/** Fire-and-forget wrapper for request paths, matching the message sweep. */
export function kickEngagementEmailSweeps(options: { db?: Db; now?: Date } = {}): void {
  void sweepMatchEmails(options).catch(() => {});
  void sweepLikeDigests(options).catch(() => {});
}

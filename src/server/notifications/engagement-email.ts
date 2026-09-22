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
 * day, counting the unread ones, sent only to somebody who is away and has been for long enough that the count
 * has settled. It names nobody — see `newLikesEmail` for why that holds even for Plus members.
 *
 * NEITHER CREATES A NOTIFICATION. Both read the rows the in-app feed already writes, so a member who has matches
 * or likes switched off has no rows, and therefore no email, without this file knowing anything about it.
 */
import { LIKE_EMAIL, MATCH_EMAIL } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { getEmailProvider } from "@/lib/email";
import { newLikesEmail, newMatchEmail } from "@/lib/email/templates";
import { emailDeliveryConfigured, getEnv } from "@/lib/env";
import { consumeRateLimit } from "@/server/auth/rate-limit";
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

  // Counted before sending, so a provider failure cannot become a retry storm against a struggling provider.
  const gate = await consumeRateLimit(db, `email:match:${input.recipientId}:${input.conversationId}`, 1, MATCH_EMAIL.perMatchCooldownMs, input.now);
  if (!gate.allowed) return "throttled";

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

/**
 * Counts the likes worth telling somebody about: unread, settled, and not so old that the moment has passed.
 *
 * The count comes from LIKE_RECEIVED notification rows rather than from the `Like` table, and that is the point —
 * those rows already honour the recipient's preference, already exclude likes they have seen, and are the same
 * thing the in-app badge counts. Two sources would eventually disagree.
 */
async function countDigestLikes(db: DbLike, recipientId: string, now: Date): Promise<number> {
  return db.notification.count({
    where: {
      userId: recipientId,
      type: "LIKE_RECEIVED",
      readAt: null,
      createdAt: {
        lt: new Date(now.getTime() - LIKE_EMAIL.unreadForMs),
        gt: new Date(now.getTime() - LIKE_EMAIL.giveUpAfterMs),
      },
    },
  });
}

/** Sends one digest, or says why it did not. The caller has already established the recipient is away. */
async function deliverLikeDigest(db: DbLike, input: { recipientId: string; now: Date }): Promise<LikeDigestOutcome> {
  const recipient = await resolveEmailRecipient(db, input.recipientId, "likes");
  if (!recipient.ok) {
    logEmailOutcome("likes", recipient.reason, input.recipientId);
    return recipient.reason;
  }

  const count = await countDigestLikes(db, input.recipientId, input.now);
  if (count < LIKE_EMAIL.minLikes) return "too-few";

  /*
   * One digest per member per day. Taken BEFORE sending and keyed on the member alone — not on the likes it
   * happens to be reporting — so a second like arriving an hour later cannot produce a second email.
   */
  const gate = await consumeRateLimit(db, `email:likes:${input.recipientId}`, 1, LIKE_EMAIL.digestEveryMs, input.now);
  if (!gate.allowed) return "throttled";

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

  const candidates = await db.notification.groupBy({
    by: ["userId"],
    where: {
      type: "LIKE_RECEIVED",
      readAt: null,
      createdAt: {
        lt: new Date(now.getTime() - LIKE_EMAIL.unreadForMs),
        gt: new Date(now.getTime() - LIKE_EMAIL.giveUpAfterMs),
      },
      user: { status: "ACTIVE", deletedAt: null, accountType: "MEMBER" },
    },
    _count: { _all: true },
    orderBy: { userId: "asc" },
    take: LIKE_EMAIL.batchSize,
  });

  // Presence for the whole batch in one query. `groupBy` cannot join, so the alternative is a lookup per
  // candidate — twenty-five round trips on a path that runs every minute.
  const users = await db.user.findMany({
    where: { id: { in: candidates.map((c) => c.userId) } },
    select: { id: true, lastActiveAt: true },
  });
  const lastActive = new Map(users.map((u) => [u.id, u.lastActiveAt]));

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

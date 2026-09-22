/**
 * Turning an in-app notification into a push, or deciding not to (docs/ARCHITECTURE.md §29.1).
 *
 * THE SHAPE, and why it is this way round:
 *
 *   event happens  →  the Notification row is written INSIDE the event's transaction  (unchanged, 11 producers)
 *                  →  later, and OUTSIDE it, this module asks whether that row deserves a push
 *
 * Push is never part of the transaction that creates a notification. A push service is a network call to somebody
 * else's machine; holding a database transaction open across it would make sending a message as slow and as
 * fragile as the slowest push endpoint in the world. So the Notification row IS the queue — exactly as it already
 * is for the away-email path (§12.16) — and this reads from it afterwards.
 *
 * IDEMPOTENCY IS A CONSTRAINT, NOT A CONVENTION. Every send claims `PushDelivery(notificationId, subscriptionId)`
 * with INSERT ... ON CONFLICT DO NOTHING RETURNING id. No row came back means somebody already has this one, and
 * this caller stops. That single fact covers every duplicate the brief lists — a retried job, a replayed request,
 * a polling page, a reconnecting client, a re-running sweep — because they all race for the same primary key and
 * the database picks exactly one winner. Nothing here counts, compares timestamps or trusts a flag.
 *
 * Two entry points, one path:
 *   - `pushForRecipient` runs right after a request that created a notification, for immediacy.
 *   - `sweepPushQueue` is the safety net for everything else: a request that died before it got here, a producer
 *     with no request behind it (the billing cron), or a member who was present at the time and has since left.
 * Both call the same evaluator, so neither can develop its own idea of the rules.
 *
 * Nothing in this file may throw into a caller. A push is a courtesy; it must never fail a message send.
 */
import { PUSH } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { webPushConfigured } from "@/lib/env";
import { sendWebPush, type PushPayload } from "@/lib/push/transport";
import type { ReactionKey } from "@/lib/reactions";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { getEntitlements } from "@/server/entitlements";
import { isPresent } from "@/server/presence";
import { PUSH_CATEGORY, isPushKind, pushCopyFor, pushUrlFor, type PushCategory, type PushKind } from "./push-copy";

/** Why a notification did or did not become a push. Returned so tests can assert on the reason, not just a count. */
export type PushOutcome =
  | "sent"
  | "not-configured"
  | "present"
  | "push-off"
  | "category-off"
  | "already-read"
  | "no-devices"
  | "already-delivered"
  | "unsupported-type"
  | "stale"
  | "failed";

/** Which preference column each category reads. Kept as data so a new category cannot be silently ungated. */
const CATEGORY_COLUMN: Record<PushCategory, "pushMessages" | "pushLikes" | "pushMatches" | "pushReactions" | "pushCommunity" | "pushAccount"> = {
  messages: "pushMessages",
  likes: "pushLikes",
  matches: "pushMatches",
  reactions: "pushReactions",
  community: "pushCommunity",
  account: "pushAccount",
};

interface Candidate {
  id: string;
  userId: string;
  type: string;
  actorId: string | null;
  conversationId: string | null;
  postId: string | null;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}

const CANDIDATE_SELECT = {
  id: true,
  userId: true,
  type: true,
  actorId: true,
  conversationId: true,
  postId: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

/**
 * May this recipient be told who the actor is?
 *
 * Three separate reasons to withhold a name, and all of them must be checked here rather than in the copy module,
 * because only this layer has the database:
 *   - a block in either direction: they are not to be named to each other, anywhere;
 *   - an account that is not ACTIVE: suspended and deleted members are not surfaced;
 *   - a LIKE: who likes you is the paywall (§12.5). A push naming the liker would hand every Free member the one
 *     thing Plus sells, on their lock screen, before they had even opened the app.
 */
async function resolveActorName(db: DbLike, row: Candidate, now: Date): Promise<string | null> {
  if (!row.actorId) return null;

  if (row.type === "LIKE_RECEIVED" || row.type === "INTRO_RECEIVED") {
    const entitlements = await getEntitlements(db as Db, row.userId, now);
    if (!entitlements.rules.canSeeIncomingLikes) return null;
  }

  const [actor, blocked] = await Promise.all([
    db.user.findFirst({
      where: { id: row.actorId, status: "ACTIVE", deletedAt: null },
      select: { profile: { select: { displayName: true } } },
    }),
    db.block.findFirst({
      where: { OR: [{ blockerId: row.userId, blockedId: row.actorId }, { blockerId: row.actorId, blockedId: row.userId }] },
      select: { id: true },
    }),
  ]);
  if (blocked || !actor) return null;
  return actor.profile?.displayName?.trim() || null;
}

/**
 * Has the recipient already dealt with this? Two questions, because "read" and "looking at it" are different.
 *
 * A MESSAGE notification for a conversation the member has read SINCE it was raised means they were in that chat
 * — the "don't push about a conversation they are actively reading" rule, decided from persisted read state
 * rather than from anything the client claimed. That also covers the case the brief warns about: a tab that
 * closed without telling us is simply a member whose read pointer stopped moving.
 */
async function alreadyHandled(db: DbLike, row: Candidate): Promise<boolean> {
  if (row.readAt !== null) return true;
  if (row.type !== "MESSAGE" && row.type !== "MESSAGE_REACTION") return false;
  if (!row.conversationId) return false;
  const participant = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: row.conversationId, userId: row.userId } },
    select: { lastReadAt: true },
  });
  return Boolean(participant?.lastReadAt && participant.lastReadAt >= row.createdAt);
}

/**
 * Claims one (notification, device) pair. Returns the delivery id, or null when somebody else already has it.
 *
 * This is the whole duplicate-protection story in one statement. `ON CONFLICT DO NOTHING` means the second caller
 * gets no row back, and a caller with no row sends nothing — so two concurrent sweeps, a retrying job and a
 * replayed request between them produce exactly one push.
 *
 * A PENDING row that has been sitting too long is retried instead, bounded by `attempts`, so a process that died
 * mid-send does not cost the member their notification for ever. The claim is still the same row, so that retry
 * cannot duplicate either.
 */
async function claim(db: DbLike, notificationId: string, subscriptionId: string, now: Date): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "PushDelivery" ("id", "notificationId", "subscriptionId", "status", "attempts", "createdAt")
    VALUES (gen_random_uuid()::text, ${notificationId}, ${subscriptionId}, 'PENDING', 1, ${now})
    ON CONFLICT ("notificationId", "subscriptionId") DO UPDATE
      SET "attempts" = "PushDelivery"."attempts" + 1
      WHERE "PushDelivery"."status" = 'PENDING'
        AND "PushDelivery"."attempts" < ${PUSH.maxAttempts}
        AND "PushDelivery"."createdAt" < ${new Date(now.getTime() - PUSH.retryStuckAfterMs)}
    RETURNING "id"
  `;
  return rows[0]?.id ?? null;
}

/** Marks an endpoint that will never work again. The row is kept: the same browser re-subscribing reuses it. */
async function disableSubscription(db: DbLike, subscriptionId: string, now: Date): Promise<void> {
  await db.pushSubscription.update({ where: { id: subscriptionId }, data: { disabledAt: now, failureCount: 0 } });
}

/**
 * Evaluates one notification and pushes it to every device that should receive it.
 *
 * The order of the gates is deliberate: the cheapest and most decisive first, so the overwhelming majority of
 * notifications cost one row read and stop.
 */
export async function pushNotification(db: DbLike, notificationId: string, now: Date = new Date()): Promise<PushOutcome> {
  if (!webPushConfigured()) return "not-configured";

  const row = (await db.notification.findUnique({ where: { id: notificationId }, select: CANDIDATE_SELECT })) as Candidate | null;
  if (!row) return "unsupported-type";
  if (!isPushKind(row.type)) return "unsupported-type";
  // Old news. The member will see it in the app; a phone buzzing about it now is noise.
  if (now.getTime() - row.createdAt.getTime() > PUSH.freshForMs) return "stale";

  const recipient = await db.user.findFirst({
    where: { id: row.userId, status: "ACTIVE", deletedAt: null, accountType: "MEMBER" },
    select: {
      lastActiveAt: true,
      notificationSettings: {
        select: { push: true, pushMessages: true, pushLikes: true, pushMatches: true, pushReactions: true, pushCommunity: true, pushAccount: true },
      },
    },
  });
  if (!recipient) return "push-off";

  // The global switch. Absent settings means the defaults, and every push default is false, so a member who has
  // never touched this is never pushed to.
  const settings = recipient.notificationSettings;
  if (!settings?.push) return "push-off";
  const category = PUSH_CATEGORY[row.type as PushKind];
  if (!settings[CATEGORY_COLUMN[category]]) return "category-off";

  // Away, and only away. Somebody using the app does not need their phone to tell them about it.
  if (isPresent(recipient.lastActiveAt, now)) return "present";
  if (await alreadyHandled(db, row)) return "already-read";

  const devices = await db.pushSubscription.findMany({
    where: { userId: row.userId, disabledAt: null, transport: "WEBPUSH" },
    select: { id: true, endpoint: true, keys: true },
    take: PUSH.maxDevicesPerUser,
  });
  if (devices.length === 0) return "no-devices";

  const actorName = await resolveActorName(db, row, now);
  const kind = row.type as PushKind;
  const copy = pushCopyFor({ kind, actorName, emoji: readEmoji(row.data) });
  const payload: PushPayload = {
    ...copy,
    url: pushUrlFor({ kind, conversationId: row.conversationId, postId: row.postId }),
    /*
     * One live notification per conversation / post / category, so a member who has been away does not come back
     * to eleven separate buzzes about the same chat — the newest replaces the older one on the lock screen.
     */
    tag: `${kind}:${row.conversationId ?? row.postId ?? row.userId}`,
  };

  let sent = 0;
  let claimed = 0;
  for (const device of devices) {
    const deliveryId = await claim(db, row.id, device.id, now);
    // Somebody else already owns this pair. Not an error — it is the duplicate protection working.
    if (!deliveryId) continue;
    claimed++;

    const keys = device.keys as { p256dh?: string; auth?: string } | null;
    if (!keys?.p256dh || !keys.auth) {
      await db.pushDelivery.update({ where: { id: deliveryId }, data: { status: "FAILED", error: "device has no keys" } });
      await disableSubscription(db, device.id, now);
      continue;
    }

    const result = await sendWebPush({ endpoint: device.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, payload);
    if (result.outcome === "sent") {
      sent++;
      await Promise.all([
        db.pushDelivery.update({ where: { id: deliveryId }, data: { status: "SENT", sentAt: now } }),
        db.pushSubscription.update({ where: { id: device.id }, data: { lastSeenAt: now, failureCount: 0 } }),
      ]);
      continue;
    }

    if (result.outcome === "gone") {
      // Permission revoked, browser data cleared, app uninstalled. Never try this endpoint again.
      await Promise.all([
        db.pushDelivery.update({ where: { id: deliveryId }, data: { status: "FAILED", error: `gone (${result.status})` } }),
        disableSubscription(db, device.id, now),
      ]);
      continue;
    }

    const failures = await db.pushSubscription.update({
      where: { id: device.id },
      data: { failureCount: { increment: 1 } },
      select: { failureCount: true },
    });
    await db.pushDelivery.update({ where: { id: deliveryId }, data: { status: "FAILED", error: result.error.slice(0, 200) } });
    // An endpoint that keeps refusing is treated as gone, so a dead device cannot be retried for ever.
    if (failures.failureCount >= PUSH.maxFailures) await disableSubscription(db, device.id, now);
  }

  if (sent > 0) return "sent";
  if (claimed === 0) return "already-delivered";
  return "failed";
}

/** The emoji a reaction notification carries, if any. Never anything else out of `data`. */
function readEmoji(data: unknown): ReactionKey | null {
  const emoji = (data as { emoji?: unknown } | null)?.emoji;
  return typeof emoji === "string" ? (emoji as ReactionKey) : null;
}

/**
 * Everything unpushed and recent for one member. Called fire-and-forget after a request that raised something,
 * so the common case reaches the phone in about as long as the request took.
 */
export async function pushForRecipient(recipientId: string, options: { db?: Db; now?: Date } = {}): Promise<PushOutcome[]> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!webPushConfigured()) return [];
  const rows = await db.notification.findMany({
    where: { userId: recipientId, readAt: null, createdAt: { gt: new Date(now.getTime() - PUSH.freshForMs) }, pushes: { none: {} } },
    orderBy: { createdAt: "asc" },
    take: PUSH.batchSize,
    select: { id: true },
  });
  const outcomes: PushOutcome[] = [];
  for (const row of rows) outcomes.push(await pushNotification(db, row.id, now));
  return outcomes;
}

/** Fire-and-forget for request paths: never awaited, never rejects. */
export function kickPush(recipientId: string, options: { db?: Db; now?: Date } = {}): void {
  void pushForRecipient(recipientId, options).catch(() => {});
}

export interface PushSweepResult {
  considered: number;
  sent: number;
  throttled: boolean;
}

/**
 * The safety net. Catches notifications no request pushed: a producer with no request behind it (the billing
 * cron), a request that died before the fire-and-forget ran, and — the case worth naming — a member who WAS in
 * the app when it arrived, so nothing was sent, and who has since gone away without reading it.
 */
export async function sweepPushQueue(options: { db?: Db; now?: Date; force?: boolean } = {}): Promise<PushSweepResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!webPushConfigured()) return { considered: 0, sent: 0, throttled: false };

  if (!options.force) {
    const gate = await consumeRateLimit(db, "push:sweep", 1, PUSH.sweepEveryMs, now);
    if (!gate.allowed) return { considered: 0, sent: 0, throttled: true };
  }

  const rows = await db.notification.findMany({
    where: {
      readAt: null,
      createdAt: { gt: new Date(now.getTime() - PUSH.freshForMs) },
      pushes: { none: {} },
      user: { status: "ACTIVE", deletedAt: null, accountType: "MEMBER", notificationSettings: { push: true } },
    },
    orderBy: { createdAt: "asc" },
    take: PUSH.batchSize,
    select: { id: true },
  });

  let sent = 0;
  for (const row of rows) {
    if ((await pushNotification(db, row.id, now)) === "sent") sent++;
  }
  return { considered: rows.length, sent, throttled: false };
}

/** Fire-and-forget for request paths. */
export function kickPushSweep(options: { db?: Db; now?: Date } = {}): void {
  void sweepPushQueue(options).catch(() => {});
}

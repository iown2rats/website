/**
 * Abandoned-checkout recovery (docs/ARCHITECTURE.md §12.19): one reminder for a Plus order left waiting for payment.
 *
 * WHO. An order that is still AWAITING_PAYMENT, has no receipt and was never submitted, is at least a day old and not
 * yet expired, was created after the cutoff, and is the member's newest order; the member is an active member without
 * Plus, and has had no checkout reminder — for this order ever, or for any order in the last 30 days. Cancelled,
 * rejected, approved and expired orders are excluded by the status alone.
 *
 * WHAT. One ACCOUNT_NOTICE notification carrying `{ kind: "CHECKOUT_REMINDER", orderId }`. The existing type, so no
 * enum changes and nothing an older build could fail to decode. The feed renders it as "Still interested in MelloCrush
 * Plus?" and links to the order's own page. No email is sent (there is no account-notice email). A push happens only
 * through the existing engine — only if the member switched account pushes on, only while they are away, at most
 * once per notification.
 *
 * ONCE. The check and the insert happen in one transaction under a per-member advisory lock, so two sweeps racing on
 * the same member cannot both create a reminder; and the eligibility query itself excludes any member who already has
 * one for this order or recently. Nothing here edits or deletes an order, a notification or anything else.
 *
 * SAFE TO SHIP. Nothing runs unless PLUS_CHECKOUT_REMINDERS is "on" AND PLUS_CHECKOUT_REMINDERS_SINCE is a valid time;
 * the cutoff is the later of that and the hard floor in CHECKOUT_REMINDER.notBefore.
 */
import { Prisma } from "@/generated/prisma/client";
import { CHECKOUT_REMINDER } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { recordPlusEvent } from "@/server/analytics/plus-funnel";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { activePlusSql, getEntitlements } from "@/server/entitlements";
import { flagEnabled } from "@/server/flags";
import { kickPush } from "@/server/notifications/push";

export const CHECKOUT_REMINDER_KIND = "CHECKOUT_REMINDER";
const MALDIVES_UTC_OFFSET_MS = 5 * 3_600_000;

export type ReminderSweepResult =
  | { ran: false; reason: "off" | "no-cutoff" | "outside-hours" | "throttled" }
  | { ran: true; created: number; skipped: number };

/** The effective cutoff, or null when reminders must not run. Never earlier than the hard floor. */
export function reminderCutoff(env: NodeJS.ProcessEnv = process.env): Date | null {
  const raw = env.PLUS_CHECKOUT_REMINDERS_SINCE;
  if (!raw) return null;
  const since = new Date(raw);
  if (Number.isNaN(since.getTime())) return null;
  return since > CHECKOUT_REMINDER.notBefore ? since : CHECKOUT_REMINDER.notBefore;
}

function withinLocalHours(now: Date): boolean {
  const hour = new Date(now.getTime() + MALDIVES_UTC_OFFSET_MS).getUTCHours();
  return hour >= CHECKOUT_REMINDER.localHours.from && hour < CHECKOUT_REMINDER.localHours.to;
}

/** Orders that qualify right now. Read-only. */
export async function findReminderCandidates(db: Db, now: Date, cutoff: Date): Promise<{ orderId: string; userId: string }[]> {
  const settled = new Date(now.getTime() - CHECKOUT_REMINDER.afterMs);
  const memberSince = new Date(now.getTime() - CHECKOUT_REMINDER.memberCooldownMs);
  return db.$queryRaw<{ orderId: string; userId: string }[]>(Prisma.sql`
    SELECT o.id AS "orderId", o."userId" AS "userId"
    FROM "SubscriptionOrder" o
    JOIN "User" u ON u.id = o."userId"
    WHERE o.status = 'AWAITING_PAYMENT'
      AND o."receiptKey" IS NULL
      AND o."submittedAt" IS NULL
      AND o."createdAt" >= ${cutoff}
      AND o."createdAt" <= ${settled}
      AND o."expiresAt" > ${now}
      AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL AND u."accountType" = 'MEMBER'
      AND NOT EXISTS (SELECT 1 FROM "SubscriptionOrder" newer WHERE newer."userId" = o."userId" AND newer."createdAt" > o."createdAt")
      AND NOT ${activePlusSql(Prisma.sql`o."userId"`, now)}
      AND NOT EXISTS (
        SELECT 1 FROM "Notification" n
        WHERE n."userId" = o."userId" AND n.type = 'ACCOUNT_NOTICE'
          AND n.data->>'kind' = ${CHECKOUT_REMINDER_KIND}
          AND (n.data->>'orderId' = o.id OR n."createdAt" > ${memberSince})
      )
    ORDER BY o."createdAt" ASC
    LIMIT ${CHECKOUT_REMINDER.batchSize}
  `);
}

/**
 * Creates the reminder for one order, or returns false. Re-checks everything under the member's lock, so a candidate
 * that changed since it was found — paid, cancelled, superseded, already reminded, now Plus — is left alone.
 */
export async function remindOrder(db: Db, candidate: { orderId: string; userId: string }, now: Date, cutoff: Date): Promise<boolean> {
  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"checkout-reminder:" + candidate.userId}))`;
    const memberSince = new Date(now.getTime() - CHECKOUT_REMINDER.memberCooldownMs);
    const existing = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Notification"
      WHERE "userId" = ${candidate.userId} AND type = 'ACCOUNT_NOTICE' AND data->>'kind' = ${CHECKOUT_REMINDER_KIND}
        AND (data->>'orderId' = ${candidate.orderId} OR "createdAt" > ${memberSince})
      LIMIT 1
    `;
    if (existing.length > 0) return false;
    const order = await tx.subscriptionOrder.findUnique({ where: { id: candidate.orderId }, select: { userId: true, status: true, receiptKey: true, submittedAt: true, createdAt: true, expiresAt: true } });
    if (!order || order.userId !== candidate.userId || order.status !== "AWAITING_PAYMENT" || order.receiptKey || order.submittedAt) return false;
    if (order.createdAt < cutoff || order.createdAt.getTime() > now.getTime() - CHECKOUT_REMINDER.afterMs || order.expiresAt <= now) return false;
    const newer = await tx.subscriptionOrder.findFirst({ where: { userId: candidate.userId, createdAt: { gt: order.createdAt } }, select: { id: true } });
    if (newer) return false;
    if ((await getEntitlements(tx, candidate.userId, now)).tier === "PLUS") return false;
    await tx.notification.create({ data: { userId: candidate.userId, type: "ACCOUNT_NOTICE", data: { kind: CHECKOUT_REMINDER_KIND, orderId: candidate.orderId }, createdAt: now } });
    return true;
  });
  if (created) {
    // After the commit, never awaited into the result: the existing engine decides presence and preference.
    kickPush(candidate.userId, { db });
    // Funnel: for this surface "seen" means the reminder reached the member's feed. Once per order; never throws.
    await recordPlusEvent({ event: "plus_prompt_viewed", userId: candidate.userId, surface: "checkout_recovery", orderId: candidate.orderId, eventKey: `reminder:${candidate.orderId}`, now }, { db });
  }
  return created;
}

/** The sweep. Off unless switched on with a cutoff; daytime only; at most once per 10 minutes unless forced. */
export async function sweepCheckoutReminders(options: { db?: Db; now?: Date; force?: boolean } = {}): Promise<ReminderSweepResult> {
  if (!flagEnabled("PLUS_CHECKOUT_REMINDERS")) return { ran: false, reason: "off" };
  const cutoff = reminderCutoff();
  if (!cutoff) return { ran: false, reason: "no-cutoff" };
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!withinLocalHours(now)) return { ran: false, reason: "outside-hours" };
  if (!options.force) {
    const gate = await consumeRateLimit(db, "billing:checkout-reminder:sweep", 1, CHECKOUT_REMINDER.sweepEveryMs, now);
    if (!gate.allowed) return { ran: false, reason: "throttled" };
  }
  const candidates = await findReminderCandidates(db, now, cutoff);
  let created = 0;
  for (const c of candidates) {
    if (await remindOrder(db, c, now, cutoff)) created += 1;
  }
  return { ran: true, created, skipped: candidates.length - created };
}

/** Fire-and-forget for request paths. Costs nothing — not even a query — while the switch is off. */
export function kickCheckoutReminderSweep(options: { db?: Db; now?: Date } = {}): void {
  if (!flagEnabled("PLUS_CHECKOUT_REMINDERS")) return;
  void sweepCheckoutReminders(options).catch(() => {});
}

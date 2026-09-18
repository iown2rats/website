/**
 * Subscription expiry (docs/ARCHITECTURE.md §12.12). Entitlement never depends on anything here: getEntitlements()
 * fails closed on `currentPeriodEnd > now`. These functions exist so a scheduler (not yet installed) can (1) warn
 * customers whose paid period ends soon and (2) mark lapsed rows EXPIRED and tell the customer. Both are idempotent:
 * one notification per subscription, keyed by its id in the notification payload.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbLike } from "@/lib/db";
import { GRANTING_SUBSCRIPTION_STATUSES } from "@/server/entitlements";

export const EXPIRY = { warnBeforeMs: 3 * 24 * 3_600_000, expiringSoonWindowMs: 7 * 24 * 3_600_000 } as const;

/** Subscriptions whose period ends within `withinMs` and that are the customer's LAST granting period. */
export async function findSubscriptionsEndingWithin(db: DbLike, now: Date, withinMs: number): Promise<{ id: string; userId: string; currentPeriodEnd: Date }[]> {
  const until = new Date(now.getTime() + withinMs);
  return db.$queryRaw<{ id: string; userId: string; currentPeriodEnd: Date }[]>(Prisma.sql`
    SELECT s.id, s."userId", s."currentPeriodEnd"
    FROM "Subscription" s
    WHERE s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED')
      AND s."currentPeriodEnd" > ${now} AND s."currentPeriodEnd" <= ${until}
      AND NOT EXISTS (
        SELECT 1 FROM "Subscription" later
        WHERE later."userId" = s."userId" AND later.id <> s.id
          AND later.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED')
          AND later."currentPeriodEnd" > s."currentPeriodEnd"
      )
    ORDER BY s."currentPeriodEnd" ASC
  `);
}

async function alreadyNotified(db: DbLike, userId: string, type: "SUBSCRIPTION_EXPIRING" | "SUBSCRIPTION_EXPIRED", subscriptionId: string): Promise<boolean> {
  const existing = await db.notification.findFirst({ where: { userId, type, data: { path: ["subscriptionId"], equals: subscriptionId } }, select: { id: true } });
  return Boolean(existing);
}

/** Warns each customer once, `EXPIRY.warnBeforeMs` before their last paid period ends. Returns how many were created. */
export async function notifyExpiringSubscriptions(db: DbLike, now: Date = new Date()): Promise<number> {
  const ending = await findSubscriptionsEndingWithin(db, now, EXPIRY.warnBeforeMs);
  let created = 0;
  for (const s of ending) {
    if (await alreadyNotified(db, s.userId, "SUBSCRIPTION_EXPIRING", s.id)) continue;
    await db.notification.create({ data: { userId: s.userId, type: "SUBSCRIPTION_EXPIRING", data: { subscriptionId: s.id, periodEnd: s.currentPeriodEnd.toISOString() }, createdAt: now } });
    created += 1;
  }
  return created;
}

/** Marks lapsed rows EXPIRED (bookkeeping only) and tells customers whose Plus has ended. */
export async function markExpiredSubscriptions(db: DbLike, now: Date = new Date()): Promise<{ expired: number; notified: number }> {
  const lapsed = await db.subscription.findMany({ where: { status: { in: [...GRANTING_SUBSCRIPTION_STATUSES] }, currentPeriodEnd: { lte: now } }, select: { id: true, userId: true, currentPeriodEnd: true } });
  let notified = 0;
  for (const s of lapsed) {
    await db.subscription.update({ where: { id: s.id }, data: { status: "EXPIRED" } });
    const stillPlus = await db.subscription.findFirst({ where: { userId: s.userId, currentPeriodEnd: { gt: now }, status: { in: [...GRANTING_SUBSCRIPTION_STATUSES] } }, select: { id: true } });
    if (stillPlus || (await alreadyNotified(db, s.userId, "SUBSCRIPTION_EXPIRED", s.id))) continue;
    await db.notification.create({ data: { userId: s.userId, type: "SUBSCRIPTION_EXPIRED", data: { subscriptionId: s.id, periodEnd: s.currentPeriodEnd.toISOString() }, createdAt: now } });
    notified += 1;
  }
  return { expired: lapsed.length, notified };
}

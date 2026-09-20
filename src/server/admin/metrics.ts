/**
 * Dashboard metrics (docs/ARCHITECTURE.md §21.3), every one computed from canonical rows at request time. No
 * counters are stored. "Today" is the Maldives calendar day (UTC+5, no DST); the 7- and 30-day figures are rolling
 * windows. There is no analytics/activity event stream, so nothing here is called "active users": the closest
 * honest figure is accounts that signed in within a window (User.lastActiveAt is set at sign-in).
 */
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/lib/db";
import { EXPIRY } from "@/server/billing/expiry";

export const MALDIVES_UTC_OFFSET_MS = 5 * 3_600_000;

export function startOfMaldivesDay(now: Date): Date {
  const shifted = now.getTime() + MALDIVES_UTC_OFFSET_MS;
  const dayStart = Math.floor(shifted / 86_400_000) * 86_400_000;
  return new Date(dayStart - MALDIVES_UTC_OFFSET_MS);
}

export interface DashboardMetrics {
  users: {
    total: number;
    nonDeleted: number;
    completedProfiles: number;
    onboarding: number;
    newToday: number;
    new7d: number;
    new30d: number;
    signedIn7d: number;
    signedIn30d: number;
    paused: number;
    suspended: number;
    banned: number;
    deleted: number;
  };
  membership: { plusNow: number; expiring7d: number; awaitingPayment: number; pendingReview: number };
  payments: { pending: number; approved30d: number; rejected30d: number };
  safety: { openReports: number; pendingVerifications: number };
  generatedAt: string;
}

/** Plain-language definition per metric key, shown in the UI so a number is never ambiguous. */
export const METRIC_DEFINITIONS: Record<string, string> = {
  "users.total": "Every member account row ever created, including deleted (anonymised) ones. Staff accounts are not counted.",
  "users.nonDeleted": "Member accounts whose status is not DELETED.",
  "users.completedProfiles": "Non-deleted member accounts that finished onboarding.",
  "users.onboarding": "Accounts still in onboarding (status ONBOARDING).",
  "users.newToday": "Accounts created since 00:00 Maldives time today.",
  "users.new7d": "Accounts created in the last 7 × 24 hours.",
  "users.new30d": "Accounts created in the last 30 × 24 hours.",
  "users.signedIn7d": "Non-deleted accounts that signed in with Google in the last 7 days. Not an activity metric; there is no activity tracking.",
  "users.signedIn30d": "Non-deleted accounts that signed in with Google in the last 30 days.",
  "users.paused": "Non-deleted accounts with Pause dating on.",
  "users.suspended": "Accounts with status SUSPENDED.",
  "users.banned": "Accounts with status BANNED.",
  "users.deleted": "Accounts with status DELETED (anonymised).",
  "membership.plusNow": "Distinct accounts holding Plus right now (a granting subscription or an entitlement override covering now).",
  "membership.expiring7d": "Accounts whose last paid Plus period ends within 7 days.",
  "membership.awaitingPayment": "Orders created but not yet submitted (not expired).",
  "membership.pendingReview": "Orders with a receipt submitted, waiting for an admin decision.",
  "payments.pending": "Same as pending review.",
  "payments.approved30d": "Orders approved in the last 30 days.",
  "payments.rejected30d": "Orders rejected in the last 30 days.",
  "safety.openReports": "Reports with status OPEN or UNDER_REVIEW.",
  "safety.pendingVerifications": "Verification rows with status SELFIE_SUBMITTED or UNDER_REVIEW.",
};

export async function getDashboardMetrics(deps: { db?: Db; now?: Date } = {}): Promise<DashboardMetrics> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const dayStart = startOfMaldivesDay(now);
  const d7 = new Date(now.getTime() - 7 * 86_400_000);
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const notDeleted = { status: { not: "DELETED" as const } };
  // Every user figure counts dating members. Staff accounts are operational: including them would make
  // "accounts" and "completed profiles" disagree by however many operators there happen to be (§22.2).
  const member = { accountType: "MEMBER" as const };

  const [total, nonDeleted, completedProfiles, onboarding, newToday, new7d, new30d, signedIn7d, signedIn30d, paused, suspended, banned, deleted, awaitingPayment, pendingReview, approved30d, rejected30d, openReports, pendingVerifications, plusRows, expiringRows] = await Promise.all([
    db.user.count({ where: member }),
    db.user.count({ where: { ...member, ...notDeleted } }),
    db.user.count({ where: { ...member, ...notDeleted, onboardingCompletedAt: { not: null } } }),
    db.user.count({ where: { ...member, status: "ONBOARDING" } }),
    db.user.count({ where: { ...member, createdAt: { gte: dayStart } } }),
    db.user.count({ where: { ...member, createdAt: { gte: d7 } } }),
    db.user.count({ where: { ...member, createdAt: { gte: d30 } } }),
    db.user.count({ where: { ...member, ...notDeleted, lastActiveAt: { gte: d7 } } }),
    db.user.count({ where: { ...member, ...notDeleted, lastActiveAt: { gte: d30 } } }),
    db.privacySettings.count({ where: { pausedAt: { not: null }, user: notDeleted } }),
    db.user.count({ where: { ...member, status: "SUSPENDED" } }),
    db.user.count({ where: { ...member, status: "BANNED" } }),
    db.user.count({ where: { ...member, status: "DELETED" } }),
    db.subscriptionOrder.count({ where: { status: "AWAITING_PAYMENT", expiresAt: { gt: now } } }),
    db.subscriptionOrder.count({ where: { status: "SUBMITTED" } }),
    db.subscriptionOrder.count({ where: { status: "APPROVED", decidedAt: { gte: d30 } } }),
    db.subscriptionOrder.count({ where: { status: "REJECTED", decidedAt: { gte: d30 } } }),
    db.report.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    db.verification.count({ where: { status: { in: ["SELFIE_SUBMITTED", "UNDER_REVIEW"] } } }),
    db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "User" u
      WHERE u.status <> 'DELETED' AND (
        EXISTS (SELECT 1 FROM "Subscription" s WHERE s."userId" = u.id AND s."currentPeriodEnd" > ${now} AND s.status IN ('ACTIVE','TRIALING','PAST_DUE','CANCELLED'))
        OR EXISTS (SELECT 1 FROM "EntitlementOverride" eo WHERE eo."userId" = u.id AND eo.tier = 'PLUS' AND eo."startsAt" <= ${now} AND eo."endsAt" > ${now})
      )`),
    db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT s."userId")::int AS n FROM "Subscription" s
      WHERE s.status IN ('ACTIVE','TRIALING','PAST_DUE','CANCELLED')
        AND s."currentPeriodEnd" > ${now} AND s."currentPeriodEnd" <= ${new Date(now.getTime() + EXPIRY.expiringSoonWindowMs)}
        AND NOT EXISTS (SELECT 1 FROM "Subscription" l WHERE l."userId" = s."userId" AND l.id <> s.id AND l.status IN ('ACTIVE','TRIALING','PAST_DUE','CANCELLED') AND l."currentPeriodEnd" > s."currentPeriodEnd")`),
  ]);

  return {
    users: { total, nonDeleted, completedProfiles, onboarding, newToday, new7d, new30d, signedIn7d, signedIn30d, paused, suspended, banned, deleted },
    membership: { plusNow: plusRows[0]?.n ?? 0, expiring7d: expiringRows[0]?.n ?? 0, awaitingPayment, pendingReview },
    payments: { pending: pendingReview, approved30d, rejected30d },
    safety: { openReports, pendingVerifications },
    generatedAt: now.toISOString(),
  };
}

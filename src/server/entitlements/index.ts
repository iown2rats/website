/**
 * Entitlement service — the only module that decides FREE vs PLUS and reads product rules.
 * See docs/ARCHITECTURE.md §12.2.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbLike } from "@/lib/db";
import { PRODUCT_RULES, USAGE_WINDOWS, type Tier, type TierRules } from "@/config/product";
import { peekUsage } from "@/server/usage/usage-window";

export type Capability = "seeIncomingLikes" | "invisibleMode" | "advancedFilters" | "undoPass";

export interface SubscriptionSummary {
  planCode: string;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

export interface Entitlements {
  tier: Tier;
  rules: TierRules;
  subscription: SubscriptionSummary | null;
  /** True when the tier comes from an EntitlementOverride rather than a subscription. */
  overridden: boolean;
}

/** Subscription statuses that keep Plus until currentPeriodEnd. EXPIRED never grants. */
export const GRANTING_SUBSCRIPTION_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELLED"] as const;

/**
 * SQL fragment: does user `userIdExpr` hold Plus at `now`? Used by the discovery predicate so the
 * Invisible Mode rule is evaluated in the database with exactly the same semantics as resolveTier().
 */
export function activePlusSql(userIdExpr: Prisma.Sql, now: Date): Prisma.Sql {
  return Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "Subscription" s
      WHERE s."userId" = ${userIdExpr}
        AND s."currentPeriodEnd" > ${now}
        AND s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED')
    )
    OR EXISTS (
      SELECT 1 FROM "EntitlementOverride" eo
      WHERE eo."userId" = ${userIdExpr}
        AND eo.tier = 'PLUS'
        AND eo."startsAt" <= ${now}
        AND eo."endsAt" > ${now}
    )
  )`;
}

export async function resolveTier(db: DbLike, userId: string, now: Date = new Date()): Promise<Tier> {
  const e = await getEntitlements(db, userId, now);
  return e.tier;
}

export async function getEntitlements(db: DbLike, userId: string, now: Date = new Date()): Promise<Entitlements> {
  const [override, subscription] = await Promise.all([
    db.entitlementOverride.findFirst({
      where: { userId, tier: "PLUS", startsAt: { lte: now }, endsAt: { gt: now } },
      select: { id: true },
    }),
    db.subscription.findFirst({
      where: { userId, currentPeriodEnd: { gt: now }, status: { in: [...GRANTING_SUBSCRIPTION_STATUSES] } },
      orderBy: { currentPeriodEnd: "desc" },
      select: { status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, plan: { select: { code: true } } },
    }),
  ]);

  const tier: Tier = override || subscription ? "PLUS" : "FREE";
  return {
    tier,
    rules: PRODUCT_RULES[tier],
    overridden: Boolean(override) && !subscription,
    subscription: subscription
      ? {
          planCode: subscription.plan.code,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
  };
}

export function can(entitlements: Entitlements, capability: Capability): boolean {
  switch (capability) {
    case "seeIncomingLikes":
      return entitlements.rules.canSeeIncomingLikes;
    case "invisibleMode":
      return entitlements.rules.canUseInvisibleMode;
    case "advancedFilters":
      return entitlements.rules.canUseAdvancedFilters;
    case "undoPass":
      return entitlements.rules.canUndoPass;
  }
}

export interface LikeAllowance {
  limit: number;
  used: number;
  remaining: number;
  /** When the current window ends. Null when no window has been opened yet (full allowance available). */
  resetsAt: Date | null;
  tier: Tier;
}

/** Read-only view for the UI ("12 likes left today", "refreshes in 6h 24m"). Does not consume. */
export async function getLikeAllowance(db: DbLike, userId: string, now: Date = new Date()): Promise<LikeAllowance> {
  const e = await getEntitlements(db, userId, now);
  const usage = await peekUsage(db, userId, "LIKES", now);
  const limit = e.rules.dailyLikeLimit;
  return { limit, used: usage.used, remaining: Math.max(0, limit - usage.used), resetsAt: usage.windowEnd, tier: e.tier };
}

export interface MessageAvailability {
  canSendNow: boolean;
  /** When the next outgoing message becomes available. Equals `now` when sending is allowed. */
  availableAt: Date;
  cooldownMs: number;
  tier: Tier;
}

/** Read-only view for the composer ("Free message available in 6:42"). The send path re-checks under lock. */
export async function getMessageAvailability(
  db: DbLike,
  userId: string,
  now: Date = new Date(),
): Promise<MessageAvailability> {
  const e = await getEntitlements(db, userId, now);
  const cooldownMs = e.rules.messageCooldownMs;
  if (cooldownMs === 0) return { canSendNow: true, availableAt: now, cooldownMs, tier: e.tier };
  const last = await db.message.findFirst({
    where: { senderId: userId, kind: "TEXT" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const availableAt = last ? new Date(last.createdAt.getTime() + cooldownMs) : now;
  return { canSendNow: availableAt.getTime() <= now.getTime(), availableAt: availableAt > now ? availableAt : now, cooldownMs, tier: e.tier };
}

export interface BoostAllowance {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: Date | null;
  activeBoostEndsAt: Date | null;
  windowMs: number;
  tier: Tier;
}

export async function getBoostAllowance(db: DbLike, userId: string, now: Date = new Date()): Promise<BoostAllowance> {
  const e = await getEntitlements(db, userId, now);
  const [usage, active] = await Promise.all([
    peekUsage(db, userId, "BOOSTS", now),
    db.boost.findFirst({ where: { userId, startsAt: { lte: now }, endsAt: { gt: now } }, select: { endsAt: true } }),
  ]);
  const limit = e.rules.boostsPerWindow;
  return {
    limit,
    used: usage.used,
    remaining: Math.max(0, limit - usage.used),
    resetsAt: usage.windowEnd,
    activeBoostEndsAt: active?.endsAt ?? null,
    windowMs: USAGE_WINDOWS.BOOSTS,
    tier: e.tier,
  };
}

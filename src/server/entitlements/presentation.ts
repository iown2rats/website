/**
 * The one safe presentation of subscription state for the browser (Phase 9 §27): tier, plan name, period end and
 * the capability flags. Never provider references, override reasons or payment data. Plans are listed by name only
 * while pricing is unapproved (SubscriptionPlan.isPlaceholderPrice).
 */
import { getDb, type Db } from "@/lib/db";
import type { Actor } from "@/server/actor";
import { getEntitlements } from ".";

export interface MembershipDto {
  tier: "FREE" | "PLUS";
  planName: string | null;
  /** ISO date when the current period ends (renews, or ends if cancelled). Null without a subscription. */
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  capabilities: {
    dailyLikeLimit: number;
    messageCooldownMinutes: number;
    seeWhoLikesYou: boolean;
    invisibleMode: boolean;
    boostsPerWeek: number;
    advancedFilters: boolean;
    undoPass: boolean;
  };
  plans: { code: string; name: string; intervalDays: number; price: string | null }[];
  paymentsAvailable: false;
}

export async function getMembership(actor: Actor, deps: { db?: Db; now?: Date } = {}): Promise<MembershipDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [e, plans, planNames] = await Promise.all([
    getEntitlements(db, actor.userId, now),
    db.subscriptionPlan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true, intervalDays: true, priceMinor: true, currency: true, isPlaceholderPrice: true } }),
    db.subscriptionPlan.findMany({ select: { code: true, name: true } }),
  ]);
  const planName = e.subscription ? (planNames.find((p) => p.code === e.subscription?.planCode)?.name ?? null) : null;
  return {
    tier: e.tier,
    planName,
    periodEnd: e.subscription?.currentPeriodEnd.toISOString() ?? null,
    cancelAtPeriodEnd: e.subscription?.cancelAtPeriodEnd ?? false,
    capabilities: {
      dailyLikeLimit: e.rules.dailyLikeLimit,
      messageCooldownMinutes: Math.round(e.rules.messageCooldownMs / 60_000),
      seeWhoLikesYou: e.rules.canSeeIncomingLikes,
      invisibleMode: e.rules.canUseInvisibleMode,
      boostsPerWeek: e.rules.boostsPerWindow,
      advancedFilters: e.rules.canUseAdvancedFilters,
      undoPass: e.rules.canUndoPass,
    },
    plans: plans.map((p) => ({
      code: p.code,
      name: p.name,
      intervalDays: p.intervalDays,
      price: p.isPlaceholderPrice ? null : `${p.currency} ${(p.priceMinor / 100).toFixed(0)}`,
    })),
    paymentsAvailable: false,
  };
}

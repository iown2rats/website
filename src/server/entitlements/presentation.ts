/**
 * The one safe presentation of membership state for the browser (Phase 9 §27; Admin/Plus phase §12.11): tier, plan
 * name, period end, capability flags, the plans that are for sale, whether payments are open, and the customer's
 * current order. Never provider references, override reasons, storage keys or anyone else's data.
 */
import { getDb, type Db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import type { Actor } from "@/server/actor";
import { getCurrentOrderForActor, type OrderDto } from "@/server/billing/orders";
import { getCheckoutPaymentMethod } from "@/server/billing/payment-methods";
import { isPlanForSale } from "@/server/billing/plans";
import { getEntitlements } from ".";

export interface MembershipPlanDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  intervalDays: number;
  badge: string | null;
  /** Formatted price, or null while the plan is only shown by name (placeholder pricing). */
  price: string | null;
  forSale: boolean;
}

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
  plans: MembershipPlanDto[];
  /** True when at least one plan is for sale and a payment method is enabled. */
  paymentsAvailable: boolean;
  currentOrder: OrderDto | null;
}

export async function getMembership(actor: Actor, deps: { db?: Db; now?: Date } = {}): Promise<MembershipDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [e, plans, planNames, method, currentOrder] = await Promise.all([
    getEntitlements(db, actor.userId, now),
    db.subscriptionPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, code: true, name: true, description: true, intervalDays: true, priceMinor: true, currency: true, badge: true, active: true, isPlaceholderPrice: true } }),
    db.subscriptionPlan.findMany({ select: { code: true, name: true } }),
    getCheckoutPaymentMethod(db),
    getCurrentOrderForActor(actor, { db, now }),
  ]);
  const planName = e.subscription ? (planNames.find((p) => p.code === e.subscription?.planCode)?.name ?? null) : null;
  const planDtos = plans.map((p) => ({ id: p.id, code: p.code, name: p.name, description: p.description, intervalDays: p.intervalDays, badge: p.badge, price: p.isPlaceholderPrice ? null : formatMoney(p.priceMinor, p.currency), forSale: isPlanForSale(p) }));
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
    plans: planDtos,
    paymentsAvailable: Boolean(method) && planDtos.some((p) => p.forSale),
    currentOrder,
  };
}

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
import { PRODUCT_RULES } from "@/config/product";
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
  /** Free vs Plus, row by row, from the approved product rules (§12.1). Display only. */
  comparison: { capability: string; free: string; plus: string }[];
}

function describeRules(): MembershipDto["comparison"] {
  const f = PRODUCT_RULES.FREE;
  const p = PRODUCT_RULES.PLUS;
  const yesNo = (v: boolean) => (v ? "Included" : "—");
  return [
    { capability: "Profile, photos, Discover, matching and chat", free: "Included", plus: "Included" },
    { capability: "Likes per day", free: String(f.dailyLikeLimit), plus: String(p.dailyLikeLimit) },
    // Messaging a match is free and unlimited on both tiers and is never a Plus upsell; the row stays so the
    // comparison answers the question rather than leaving a reader to wonder (§12.4).
    { capability: "Messaging your matches", free: "Unlimited", plus: "Unlimited" },
    { capability: "See who likes you", free: f.canSeeIncomingLikes ? "Included" : "Count only", plus: yesNo(p.canSeeIncomingLikes) },
    { capability: "Invisible Mode", free: yesNo(f.canUseInvisibleMode), plus: yesNo(p.canUseInvisibleMode) },
    { capability: "Profile Boosts", free: f.boostsPerWindow ? `${f.boostsPerWindow} a week` : "—", plus: p.boostsPerWindow ? `${p.boostsPerWindow} a week` : "—" },
    { capability: "Advanced filters", free: yesNo(f.canUseAdvancedFilters), plus: yesNo(p.canUseAdvancedFilters) },
    { capability: "Undo your last pass", free: yesNo(f.canUndoPass), plus: yesNo(p.canUndoPass) },
    { capability: "Intro with a like", free: f.introsPerWeek === null ? "Unlimited" : `${f.introsPerWeek} a week`, plus: p.introsPerWeek === null ? "Unlimited" : `${p.introsPerWeek} a week` },
    { capability: "Block, report and safety tools", free: "Always", plus: "Always" },
  ];
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
      seeWhoLikesYou: e.rules.canSeeIncomingLikes,
      invisibleMode: e.rules.canUseInvisibleMode,
      boostsPerWeek: e.rules.boostsPerWindow,
      advancedFilters: e.rules.canUseAdvancedFilters,
      undoPass: e.rules.canUndoPass,
    },
    plans: planDtos,
    paymentsAvailable: Boolean(method) && planDtos.some((p) => p.forSale),
    currentOrder,
    comparison: describeRules(),
  };
}

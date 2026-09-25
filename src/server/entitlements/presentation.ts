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
import { getEntitlements, getSuperLikeAllowance, type SuperLikeAllowance } from ".";
import { superLikeAllowanceText } from "@/lib/super-likes";

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
  comparison: ComparisonRow[];
  /** What everybody gets regardless of plan, so the table only has to carry the differences. */
  alwaysIncluded: string;
  /**
   * A Plus member's Super Likes this window ("3 of 5 Super Likes left · Resets in 4 days"). Null for Free: there is
   * no allowance to show, and a Free member's page is about what Plus adds, not a zero.
   */
  superLikes: { limit: number; remaining: number; resetsAt: string | null; left: string; reset: string | null } | null;
}

/**
 * A cell's meaning, not its rendering. "Included" is a state the page draws as the Plus mark and "—" is a state it
 * draws as a dash; sending those glyphs as strings from here would put presentation in the read model and force the
 * page to compare against them to lay anything out differently.
 */
export type ComparisonCell = { kind: "text"; text: string } | { kind: "included" } | { kind: "excluded" };

export interface ComparisonRow {
  /** Stable identity for the row, so the page can attach an icon without matching on the label. */
  key: "likes" | "incoming-likes" | "super-likes" | "invisible" | "boosts" | "filters" | "undo";
  capability: string;
  /** An optional second line under the capability. */
  detail?: string;
  free: ComparisonCell;
  plus: ComparisonCell;
}

function describeRules(): ComparisonRow[] {
  const f = PRODUCT_RULES.FREE;
  const p = PRODUCT_RULES.PLUS;
  const text = (t: string): ComparisonCell => ({ kind: "text", text: t });
  const flag = (v: boolean): ComparisonCell => (v ? { kind: "included" } : { kind: "excluded" });
  const perWeek = (n: number | null): ComparisonCell => (n === null ? text("Unlimited") : text(`${n} per week`));
  const superLikes = (n: number): ComparisonCell => (n > 0 ? text(`${n} every 7 days`) : { kind: "excluded" });

  /*
   * Only the DIFFERENCES between the tiers. What both tiers get — profiles, photos, Discover, matching, messaging
   * your matches, blocking and reporting — is stated once in `alwaysIncluded` instead of as rows of "Included /
   * Included", which read as filler and made the table three rows longer than the thing it was comparing.
   */
  return [
    { key: "likes", capability: "Likes per day", free: text(String(f.dailyLikeLimit)), plus: text(String(p.dailyLikeLimit)) },
    { key: "incoming-likes", capability: "See who likes you", free: f.canSeeIncomingLikes ? text("Full profiles") : text("Count only"), plus: p.canSeeIncomingLikes ? text("Full profiles") : text("Count only") },
    // Replaces "Intro with a like", which advertised a never-built feature. The message is part of the Super Like.
    { key: "super-likes", capability: "Super Likes ⭐", detail: "Send a message with your Super Like", free: superLikes(f.superLikesPerWindow), plus: superLikes(p.superLikesPerWindow) },
    { key: "invisible", capability: "Invisible Mode", free: flag(f.canUseInvisibleMode), plus: flag(p.canUseInvisibleMode) },
    { key: "boosts", capability: "Profile Boosts", free: f.boostsPerWindow ? perWeek(f.boostsPerWindow) : { kind: "excluded" }, plus: p.boostsPerWindow ? perWeek(p.boostsPerWindow) : { kind: "excluded" } },
    { key: "filters", capability: "Advanced filters", free: flag(f.canUseAdvancedFilters), plus: flag(p.canUseAdvancedFilters) },
    { key: "undo", capability: "Undo your last pass", free: flag(f.canUndoPass), plus: flag(p.canUndoPass) },
  ];
}

/** Stated once, next to the table, rather than as rows that say the same thing in both columns. */
const ALWAYS_INCLUDED =
  "Profiles, photos, Discover, matching, messaging your matches, blocking and reporting are available without Plus.";

export async function getMembership(actor: Actor, deps: { db?: Db; now?: Date } = {}): Promise<MembershipDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [e, plans, planNames, method, currentOrder, superAllowance] = await Promise.all([
    getEntitlements(db, actor.userId, now),
    db.subscriptionPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, code: true, name: true, description: true, intervalDays: true, priceMinor: true, currency: true, badge: true, active: true, isPlaceholderPrice: true } }),
    db.subscriptionPlan.findMany({ select: { code: true, name: true } }),
    getCheckoutPaymentMethod(db),
    getCurrentOrderForActor(actor, { db, now }),
    getSuperLikeAllowance(db, actor.userId, now),
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
    alwaysIncluded: ALWAYS_INCLUDED,
    superLikes: superLikesDto(superAllowance, now),
  };
}

/** Plus only; the wording is resolved here, against the request's clock, so the page renders it as given. */
function superLikesDto(a: SuperLikeAllowance, now: Date): MembershipDto["superLikes"] {
  if (a.limit <= 0) return null;
  const view = { limit: a.limit, remaining: a.remaining, resetsAt: a.resetsAt?.toISOString() ?? null };
  return { ...view, ...superLikeAllowanceText(view, now.getTime()) };
}

/**
 * Thundi product rules — the single source of truth for monetization limits.
 * Approved 2026-09-17. See docs/ARCHITECTURE.md §12.
 *
 * Nothing outside src/server/entitlements should read these tables directly;
 * components receive already-derived values.
 */

export type Tier = "FREE" | "PLUS";

export interface TierRules {
  /** Likes allowed per rolling 24-hour usage window. */
  readonly dailyLikeLimit: number;
  /** Minimum spacing between outgoing chat messages, across all conversations. 0 = none. */
  readonly messageCooldownMs: number;
  /** Full "Likes You" profiles (true) or count + anonymised placeholders (false). */
  readonly canSeeIncomingLikes: boolean;
  /** Invisible Mode: only people the user has liked can discover them. */
  readonly canUseInvisibleMode: boolean;
  /** Profile boosts allowed per rolling 7-day window. 0 = none. */
  readonly boostsPerWindow: number;
  readonly canUseAdvancedFilters: boolean;
  /** Undo the most recent Pass. */
  readonly canUndoPass: boolean;
  /** Intros sent with a like per ISO week. null = unlimited. */
  readonly introsPerWeek: number | null;
}

export const PRODUCT_RULES = {
  FREE: {
    dailyLikeLimit: 30,
    messageCooldownMs: 9 * 60_000,
    canSeeIncomingLikes: false,
    canUseInvisibleMode: false,
    boostsPerWindow: 0,
    canUseAdvancedFilters: false,
    canUndoPass: false,
    introsPerWeek: 1,
  },
  PLUS: {
    dailyLikeLimit: 90,
    messageCooldownMs: 0,
    canSeeIncomingLikes: true,
    canUseInvisibleMode: true,
    boostsPerWindow: 2,
    canUseAdvancedFilters: true,
    canUndoPass: true,
    introsPerWeek: null,
  },
} as const satisfies Record<Tier, TierRules>;

/** Rolling window lengths for UsageCounter kinds (§12.3, §12.8). */
export const USAGE_WINDOWS = {
  LIKES: 24 * 3_600_000,
  BOOSTS: 7 * 24 * 3_600_000,
} as const;

export type UsageKindKey = keyof typeof USAGE_WINDOWS;

/** Boost behaviour. Duration and ranking weight live here, not in query code. */
export const BOOST = {
  durationMs: 30 * 60_000,
  /** Relative ordering weight used by discovery ranking; 1 = boosted candidates sort first. */
  rankingWeight: 1,
} as const;

/**
 * Undo (Plus): only the most recent Pass, and only while it is still eligible (not already undone,
 * no later swipe action). Approved 2026-09-17: no time-based expiry. `maxAgeMs` stays as a
 * structural hook; set a number to reintroduce a limit later.
 */
export const UNDO: { readonly maxAgeMs: number | null } = {
  maxAgeMs: null,
};

/**
 * Anti-abuse ceiling. This is a SAFETY rule, not a monetization rule: it applies to every tier,
 * Plus included, and is independent of the Free message cooldown in PRODUCT_RULES.
 */
export const MESSAGE_SPAM_CEILING = {
  perMinute: 30,
} as const;

/** Passed profiles resurface after this long unless undone. */
export const PASS_TTL_MS = 30 * 24 * 3_600_000;

/** Message body limits. */
export const MESSAGE_LIMITS = { minLength: 1, maxLength: 2000 } as const;
export const INTRO_LIMITS = { maxLength: 140 } as const;

/** Photo limits from the prototype. */
export const PHOTO_LIMITS = { min: 2, max: 6 } as const;
export const INTEREST_LIMITS = { max: 6 } as const;
export const PROMPT_LIMITS = { max: 3 } as const;

/**
 * Subscription plans. PRICES ARE PLACEHOLDERS — NOT PRODUCTION PRICING.
 * Final MVR pricing is pending approval; the UI must show a development-pricing notice
 * while any displayed plan has isPlaceholderPrice = true.
 */
export const PLAN_CATALOG = [
  { code: "WEEKLY", name: "1 week", intervalDays: 7, priceMinor: 4_900, currency: "MVR", badge: null, discountLabel: null, sortOrder: 0 },
  { code: "MONTHLY", name: "1 month", intervalDays: 30, priceMinor: 14_900, currency: "MVR", badge: "Most popular", discountLabel: null, sortOrder: 1 },
  { code: "QUARTERLY", name: "3 months", intervalDays: 90, priceMinor: 35_700, currency: "MVR", badge: "Best value", discountLabel: null, sortOrder: 2 },
] as const;

export const PLACEHOLDER_PRICING = true;

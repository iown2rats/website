/**
 * Mellocrush product rules — the single source of truth for monetization limits.
 * Approved 2026-09-17. See docs/ARCHITECTURE.md §12.
 *
 * Nothing outside src/server/entitlements should read these tables directly;
 * components receive already-derived values.
 */

export type Tier = "FREE" | "PLUS";

export interface TierRules {
  /** Likes allowed per rolling 24-hour usage window. */
  readonly dailyLikeLimit: number;
  /** Full "Likes You" profiles (true) or count + anonymised placeholders (false). */
  readonly canSeeIncomingLikes: boolean;
  /**
   * Photos beyond someone's main one, before matching. A match unlocks them for everybody regardless of tier, so
   * this rule only ever decides the UNMATCHED case (docs/ARCHITECTURE.md §12.18).
   */
  readonly canSeeProtectedPhotos: boolean;
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
    canSeeIncomingLikes: false,
    canSeeProtectedPhotos: false,
    canUseInvisibleMode: false,
    boostsPerWindow: 0,
    canUseAdvancedFilters: false,
    canUndoPass: false,
    introsPerWeek: 1,
  },
  PLUS: {
    dailyLikeLimit: 90,
    canSeeIncomingLikes: true,
    canSeeProtectedPhotos: true,
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
 * Anti-abuse ceiling, and the ONLY limit on messages inside a match. This is a SAFETY rule, not a monetization
 * rule: it applies to every tier, Plus included, and is never presented as something an upgrade removes. Messaging
 * a match is free and unlimited on every tier (docs/ARCHITECTURE.md §12.4) — there is no tier field for it,
 * deliberately, so the rule cannot be reintroduced by flipping a config value.
 */
export const MESSAGE_SPAM_CEILING = {
  perMinute: 30,
  /**
   * Reactions and edits get their own ceilings for the same reason and on the same terms: safety, every tier, no
   * upgrade removes them. They are separate numbers because they are separate kinds of noise — a reaction is one
   * tap and costs the recipient a glance, so it can be looser than a message; an edit rewrites something already
   * on someone else's screen, so it is tighter. Neither shares the message budget: reacting to a chat should
   * never be able to use up the allowance for actually replying.
   */
  reactionsPerMinute: 60,
  editsPerMinute: 20,
} as const;

/** Passed profiles resurface after this long unless undone. */
export const PASS_TTL_MS = 30 * 24 * 3_600_000;

/**
 * Community limits (docs/ARCHITECTURE.md §14). Kinds and the single heart reaction follow the prototype.
 * Ceilings are anti-abuse for every tier, never monetization.
 */
export const COMMUNITY = {
  postMaxLength: 1000,
  commentMaxLength: 500,
  feedPageSize: 12,
  commentsPageSize: 30,
  /** "New" tab window. */
  newWindowMs: 24 * 3_600_000,
  /** Anti-abuse ceilings (RateLimitBucket). */
  postsPerHour: 10,
  commentsPerMinute: 20,
  reactionsPerMinute: 60,
  /** Longest "who reacted" list. A sheet on a 320px screen cannot usefully show more, and it bounds the query. */
  reactorsPageSize: 50,
  /**
   * OWNER DECISION (approved 2026-09-17): Invisible Mode controls dating-discovery visibility only. An Invisible
   * Mode user may view Community, post, comment, react and have their Community profile/content viewed under the
   * normal Community privacy rules. Community participation never makes them eligible for or visible in Discover
   * unless the Phase 6 discovery rules independently allow it, and Community never reveals dating eligibility,
   * discovery preferences, likes or the Invisible Mode state. The setting UI discloses this (§12.6). Regression
   * test: tests/integration/community.test.ts "Invisible Mode + Community".
   */
  invisibleModeParticipation: "ALLOWED" as "ALLOWED" | "READ_ONLY",
} as const;

/** Message body limits. */
export const MESSAGE_LIMITS = { minLength: 1, maxLength: 2000 } as const;
export const INTRO_LIMITS = { maxLength: 140 } as const;

/** Photo limits from the prototype. */
export const PHOTO_LIMITS = { min: 2, max: 6 } as const;

/**
 * Discovery rules (docs/ARCHITECTURE.md §7).
 *  - A candidate needs `minDisplayablePhotos` photos in a displayable moderation state to appear. Which states
 *    are displayable is decided centrally by src/lib/photo-policy.ts (APPROVED only in production).
 *  - Batches are bounded; the client asks for more before the deck runs dry and sends the handles it is
 *    still holding so adjacent batches never overlap.
 */
export const DISCOVERY = {
  batchSize: 12,
  maxBatchSize: 30,
  /** Fetch the next batch when this many or fewer cards remain. */
  refillThreshold: 4,
  minDisplayablePhotos: PHOTO_LIMITS.min,
  /** Filter slider bounds from the prototype. */
  filterAgeMin: 18,
  filterAgeMax: 60,
  /** Maximum handles a client may pass as "already in my deck". */
  maxExcludeHandles: 60,
} as const;
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

/**
 * Notification feed sizes (docs/ARCHITECTURE.md §13). The bell's dropdown asks for exactly what it shows; the
 * dedicated page pages through the rest. Lives here rather than in the server module so the client can read it
 * without pulling the database layer into its bundle.
 */
/**
 * Presence: what "using the app right now" means (docs/ARCHITECTURE.md §12.17).
 *
 * `activeWithinMs` is deliberately longer than `touchEveryMs`. Presence is refreshed at most once a minute, so a
 * window equal to it would flicker: a member who loaded a page 61 seconds ago would read as away. Five minutes
 * covers reading a long chat, composing a reply, or glancing at another app and coming back.
 */
export const PRESENCE = {
  /** Treated as being in the app if the server heard from them this recently. */
  activeWithinMs: 5 * 60_000,
  /** Upper bound on presence writes per member. */
  touchEveryMs: 60_000,
} as const;

/**
 * Push delivery (docs/ARCHITECTURE.md §29). Anti-noise, not monetization: none of this differs by tier.
 */
export const PUSH = {
  /**
   * How long after a notification is created it is still worth pushing. A notification found by the sweep hours
   * later is news the member will see in the app anyway, and a phone buzzing about something stale is worse than
   * silence.
   */
  freshForMs: 30 * 60_000,
  /** Most devices a member may register. Generous, but not a way to make one account fan out indefinitely. */
  maxDevicesPerUser: 20,
  /** Consecutive transient failures before an endpoint is disabled. A permanent failure disables immediately. */
  maxFailures: 5,
  /** How many notifications one sweep will consider. */
  batchSize: 50,
  /** Floor between sweeps, so ordinary traffic cannot turn into a stampede of them. */
  sweepEveryMs: 60_000,
  /** How long a PENDING claim may sit before the sweep is allowed to try it again. */
  retryStuckAfterMs: 5 * 60_000,
  /** Attempts per (notification, device) before giving up for good. */
  maxAttempts: 3,
} as const;

/**
 * "Someone messaged you while you were away" email (docs/ARCHITECTURE.md §12.13).
 *
 * The trigger is "still unread after a while", not "user looks offline". The only activity signals available are
 * User.lastActiveAt, which is written at sign-in, and Session.lastSeenAt, which is refreshed at most hourly on
 * purpose so a browsing session is not a write per request. Neither can answer "is she looking at the app right
 * now", and guessing wrong means emailing somebody who is mid-conversation. Unread-after-a-delay needs no guess.
 */
export const MESSAGE_EMAIL = {
  /** Long enough that someone who picks the phone up is never emailed about a message they then read. */
  unreadForMs: 10 * 60_000,
  /** At most one per conversation per window, so a burst of twenty messages is still one email. */
  perConversationCooldownMs: 6 * 3_600_000,
  /** The sweep is cheap but not free, and it is driven by ordinary traffic; once a minute is plenty. */
  sweepEveryMs: 60_000,
  /** Cap on one sweep, so a backlog drains over several runs rather than one long request. */
  batchSize: 25,
  /** Older than this and an email is worse than silence — the moment has passed. */
  giveUpAfterMs: 7 * 24 * 3_600_000,
} as const;

export const NOTIFICATION_FEED = {
  dropdownSize: 5,
  pageSize: 20,
  maxPageSize: 50,
  /** Longest message preview shown in a row. */
  previewChars: 70,
} as const;

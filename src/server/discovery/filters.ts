/**
 * Discovery filters (docs/ARCHITECTURE.md §7.4). Persisted on DiscoveryPreferences, never in localStorage.
 * Basic filters are for everyone; advanced filters (height, education) are Plus-only: a Free client that submits
 * them has the values discarded here AND the query ignores stored advanced values without the entitlement.
 */
import { z } from "zod";
import { DISCOVERY } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";
import { ageFromDateOfBirth } from "@/lib/age";
import { DEFAULT_AGE_PREFERENCES } from "@/server/preferences/defaults";
import { canDate, datingFieldsApply, datingInterestedIn, resolvePreferences, type ConnectionIntent } from "@/server/preferences/intent-policy";

const RELATIONSHIP_INTENTS = ["SERIOUS_RELATIONSHIP", "DATING", "MARRIAGE", "FIGURING_OUT"] as const;
type RelationshipIntent = (typeof RELATIONSHIP_INTENTS)[number];

export const filtersSchema = z
  .object({
    connectionIntent: z.enum(["DATING", "FRIENDSHIP"]),
    // Friendship's answer. Ignored on Dating, where the preference is derived from gender and a submitted value
    // is not trusted — that is the whole point of deriving it.
    interestedIn: z.enum(["WOMEN", "MEN", "EVERYONE"]),
    ageMin: z.number().int().min(DISCOVERY.filterAgeMin).max(DISCOVERY.filterAgeMax),
    ageMax: z.number().int().min(DISCOVERY.filterAgeMin).max(DISCOVERY.filterAgeMax),
    locationScope: z.enum(["ANYWHERE", "GREATER_MALE", "MY_ATOLL", "SPECIFIC"]),
    locationId: z.string().min(1).max(64).nullable().optional(),
    // The Dating "Looking for" filter. Ignored on Friendship: the stored value is kept, not overwritten.
    intent: z.enum(RELATIONSHIP_INTENTS).nullable().optional(),
    // The member's OWN answer to "What are you looking for?", asked by the sheet only when they switch into Dating
    // without one (a member who onboarded through Friendship was never asked). Ignored everywhere else.
    myIntent: z.enum(RELATIONSHIP_INTENTS).nullable().optional(),
    heightMinCm: z.number().int().min(120).max(230).nullable().optional(),
    heightMaxCm: z.number().int().min(120).max(230).nullable().optional(),
    education: z.string().trim().max(60).regex(/^[^<>]*$/, "Education can't contain < or >").nullable().optional(),
  })
  .refine((f) => f.ageMin <= f.ageMax, { message: "Minimum age must not exceed maximum age", path: ["ageMax"] })
  .refine((f) => f.heightMinCm == null || f.heightMaxCm == null || f.heightMinCm <= f.heightMaxCm, { message: "Minimum height must not exceed maximum", path: ["heightMaxCm"] })
  .refine((f) => f.locationScope !== "SPECIFIC" || Boolean(f.locationId), { message: "Choose an island or atoll", path: ["locationId"] });

export type FiltersInput = z.infer<typeof filtersSchema>;

export interface DiscoveryFiltersDto {
  connectionIntent: ConnectionIntent;
  /** The preference in force. Read-only in the UI on Dating, because it is derived rather than chosen. */
  interestedIn: "WOMEN" | "MEN" | "EVERYONE";
  /** Whether "Show me" is the member's to change here. False on Dating. */
  interestedInEditable: boolean;
  /** What "Show me" becomes if they switch to Dating; null when their gender cannot date. Lets the sheet show the
   *  consequence of the switch immediately instead of leaving a stale answer until the save returns. */
  datingInterestedIn: "WOMEN" | "MEN" | null;
  /** THE remembered Friendship answer, the one the sheet restores on a switch into Friendship. Null if never given. */
  friendshipInterestedIn: "WOMEN" | "MEN" | "EVERYONE" | null;
  /** False when the member's gender cannot use Dating ("Prefer not to say"); the sheet then explains, not offers. */
  canDate: boolean;
  /** Whether the member has their own Dating answer ("What are you looking for?"). Switching into Dating needs one. */
  hasDatingIntent: boolean;
  /** The member's own age, so the sheet can warn when their range leaves it out. Their own, never anybody else's. */
  ownAge: number | null;
  ageMin: number;
  ageMax: number;
  locationScope: "ANYWHERE" | "GREATER_MALE" | "MY_ATOLL" | "SPECIFIC";
  locationId: string | null;
  /** The stored Dating "Looking for". Shown and applied on Dating only; kept, hidden and inert on Friendship. */
  intent: RelationshipIntent | null;
  heightMinCm: number | null;
  heightMaxCm: number | null;
  education: string | null;
  /** Whether advanced filters are in effect for this user (Plus). */
  advancedEnabled: boolean;
  /** Whether the viewer has a home location (needed for "My atoll"). */
  hasOwnLocation: boolean;
}

/** The filters a member starts with, and what Reset returns to. The age range is THE canonical default. */
export const DEFAULT_FILTERS = {
  ...DEFAULT_AGE_PREFERENCES,
  locationScope: "ANYWHERE",
  locationId: null,
  intent: null,
  heightMinCm: null,
  heightMaxCm: null,
  education: null,
} as const satisfies Pick<DiscoveryFiltersDto, "ageMin" | "ageMax" | "locationScope" | "locationId" | "intent" | "heightMinCm" | "heightMaxCm" | "education">;

export async function getDiscoveryFilters(actor: Actor, options: { db?: Db; now?: Date } = {}): Promise<DiscoveryFiltersDto> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const [prefs, entitlements, profile, user] = await Promise.all([
    db.discoveryPreferences.findUnique({ where: { userId: actor.userId } }),
    getEntitlements(db, actor.userId, now),
    db.profile.findUnique({ where: { userId: actor.userId }, select: { locationId: true, intent: true } }),
    db.user.findUnique({ where: { id: actor.userId }, select: { gender: true, dateOfBirth: true } }),
  ]);
  const advancedEnabled = entitlements.rules.canUseAdvancedFilters;
  const connectionIntent = prefs?.connectionIntent ?? "DATING";
  return {
    connectionIntent,
    interestedIn: prefs?.interestedIn ?? "EVERYONE",
    interestedInEditable: connectionIntent === "FRIENDSHIP",
    datingInterestedIn: datingInterestedIn(user?.gender ?? null),
    friendshipInterestedIn: prefs?.friendshipInterestedIn ?? null,
    canDate: canDate(user?.gender ?? null),
    hasDatingIntent: Boolean(profile?.intent),
    ownAge: user?.dateOfBirth ? ageFromDateOfBirth(user.dateOfBirth, now) : null,
    ageMin: prefs?.ageMin ?? DEFAULT_FILTERS.ageMin,
    ageMax: prefs?.ageMax ?? DEFAULT_FILTERS.ageMax,
    locationScope: prefs?.locationScope ?? "ANYWHERE",
    locationId: prefs?.locationId ?? null,
    intent: prefs?.intent ?? null,
    heightMinCm: advancedEnabled ? (prefs?.heightMinCm ?? null) : null,
    heightMaxCm: advancedEnabled ? (prefs?.heightMaxCm ?? null) : null,
    education: advancedEnabled ? (prefs?.education ?? null) : null,
    advancedEnabled,
    hasOwnLocation: Boolean(profile?.locationId),
  };
}

export async function saveDiscoveryFilters(actor: Actor, input: unknown, options: { db?: Db; now?: Date } = {}): Promise<DiscoveryFiltersDto> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Those filters aren't valid");
  const f = parsed.data;

  if (f.locationScope === "SPECIFIC") {
    const exists = await db.location.findUnique({ where: { id: f.locationId! }, select: { id: true } });
    if (!exists) throw new ValidationError("Choose an island or atoll from the list");
  }
  const [entitlements, user, existing, profile] = await Promise.all([
    getEntitlements(db, actor.userId, now),
    db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { gender: true } }),
    db.discoveryPreferences.findUnique({ where: { userId: actor.userId }, select: { friendshipInterestedIn: true, intent: true } }),
    db.profile.findUnique({ where: { userId: actor.userId }, select: { intent: true } }),
  ]);
  const advanced = entitlements.rules.canUseAdvancedFilters;
  const dating = datingFieldsApply(f.connectionIntent);

  /*
   * The intent and its preference are settled by the policy, not by the request.
   *
   * On Dating the submitted "Show me" is discarded and the value derived from gender, so a crafted request cannot
   * put a man in the men's pool. On Friendship the submitted value IS the member's answer and is recorded as such,
   * which is what makes a later switch back to Friendship remember it instead of re-asking. Switching Dating →
   * Friendship with nothing remembered takes the value in front of them, because the sheet did ask.
   */
  const resolved = resolvePreferences({
    gender: user.gender,
    connectionIntent: f.connectionIntent,
    friendshipInterestedIn: f.connectionIntent === "FRIENDSHIP" ? f.interestedIn : (existing?.friendshipInterestedIn ?? null),
  });

  /*
   * Dating needs the member's own answer to "What are you looking for?" before it is set up. Somebody who onboarded
   * through Friendship was never asked, so switching them into Dating without one is refused rather than leaving a
   * Dating profile that every "Looking for" filter silently skips. The sheet asks the question inline.
   */
  const myIntent = dating && !profile?.intent ? (f.myIntent ?? null) : null;
  if (dating && !profile?.intent && !myIntent) throw new ValidationError("Choose what you're looking for to use Dating.");

  // The Dating "Looking for" filter: taken from the request on Dating; on Friendship the stored value is carried
  // through untouched (hidden and inert — the query ignores it) so switching back restores it.
  const intent = dating ? (f.intent ?? null) : (existing?.intent ?? null);
  const row = {
    ...resolved,
    ageMin: f.ageMin,
    ageMax: f.ageMax,
    locationScope: f.locationScope,
    locationId: f.locationScope === "SPECIFIC" ? f.locationId! : null,
    intent,
    // Free users cannot store advanced values at all: submitting them is a no-op, not a silent upgrade.
    heightMinCm: advanced ? (f.heightMinCm ?? null) : null,
    heightMaxCm: advanced ? (f.heightMaxCm ?? null) : null,
    education: advanced ? (f.education || null) : null,
  };
  await db.$transaction(async (tx) => {
    await tx.discoveryPreferences.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId, ...row }, update: row });
    // Written only when missing: changing an existing answer is Edit profile's job, not the filter sheet's.
    if (myIntent) await tx.profile.updateMany({ where: { userId: actor.userId, intent: null }, data: { intent: myIntent } });
  });
  return getDiscoveryFilters(actor, { db, now });
}

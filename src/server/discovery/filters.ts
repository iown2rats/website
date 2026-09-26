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
import { AGE_RANGE_TOO_NARROW } from "@/lib/discovery-filters";
import { DEFAULT_AGE_PREFERENCES } from "@/server/preferences/defaults";
import { assertPoolAllowed, canDate, datingFieldsApply, type ConnectionIntent } from "@/server/preferences/intent-policy";

const RELATIONSHIP_INTENTS = ["SERIOUS_RELATIONSHIP", "DATING", "MARRIAGE", "FIGURING_OUT"] as const;

export const filtersSchema = z
  .object({
    connectionIntent: z.enum(["DATING", "FRIENDSHIP"]),
    // The old "Show me". No longer a filter: accepted from an older client so its request still parses, never read.
    interestedIn: z.enum(["WOMEN", "MEN", "EVERYONE"]).nullable().optional(),
    ageMin: z.number().int().min(DISCOVERY.filterAgeMin).max(DISCOVERY.filterAgeMax),
    ageMax: z.number().int().min(DISCOVERY.filterAgeMin).max(DISCOVERY.filterAgeMax),
    locationScope: z.enum(["ANYWHERE", "GREATER_MALE", "MY_ATOLL", "SPECIFIC"]),
    locationId: z.string().min(1).max(64).nullable().optional(),
    // The old Dating "Looking for" filter. No longer a filter: accepted from an older client, never read; the stored
    // value is carried through untouched.
    intent: z.enum(RELATIONSHIP_INTENTS).nullable().optional(),
    // The member's OWN answer to "What are you looking for?", offered (optionally) when they switch into Dating
    // without one. Written only when their profile has none. Never required: a missing answer hides nobody.
    myIntent: z.enum(RELATIONSHIP_INTENTS).nullable().optional(),
    heightMinCm: z.number().int().min(120).max(230).nullable().optional(),
    heightMaxCm: z.number().int().min(120).max(230).nullable().optional(),
    education: z.string().trim().max(60).regex(/^[^<>]*$/, "Education can't contain < or >").nullable().optional(),
  })
  .refine((f) => f.ageMin <= f.ageMax, { message: "Minimum age must not exceed maximum age", path: ["ageMax"] })
  // The same minimum span the sliders enforce (src/lib/discovery-filters.ts), so a collapsed range like 60–60 can't
  // be saved by any client. Stored rows narrower than this are never rewritten; they just can't be saved again as is.
  .refine((f) => f.ageMax - f.ageMin >= DISCOVERY.filterAgeMinSpan, { message: AGE_RANGE_TOO_NARROW, path: ["ageMax"] })
  .refine((f) => f.heightMinCm == null || f.heightMaxCm == null || f.heightMinCm <= f.heightMaxCm, { message: "Minimum height must not exceed maximum", path: ["heightMaxCm"] })
  .refine((f) => f.locationScope !== "SPECIFIC" || Boolean(f.locationId), { message: "Choose an island or atoll", path: ["locationId"] });

export type FiltersInput = z.infer<typeof filtersSchema>;

/**
 * What the Filters sheet shows (2026-09-26): age range, Dating/Friendship, location, and Plus advanced filters.
 * There is no "Show me" (who a member sees follows from their gender and pool) and no "Looking for" (relationship
 * intention is shown on profiles but never filters anybody out).
 */
export interface DiscoveryFiltersDto {
  connectionIntent: ConnectionIntent;
  /** False when the member's gender cannot use Dating (legacy "Prefer not to say"); the sheet then explains, not offers. */
  canDate: boolean;
  /** Whether the member has their own Dating answer. A switch into Dating without one may offer the question, optionally. */
  hasDatingIntent: boolean;
  /** The member's own age, so the sheet can warn when their range leaves it out. Their own, never anybody else's. */
  ownAge: number | null;
  ageMin: number;
  ageMax: number;
  locationScope: "ANYWHERE" | "GREATER_MALE" | "MY_ATOLL" | "SPECIFIC";
  locationId: string | null;
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
  heightMinCm: null,
  heightMaxCm: null,
  education: null,
} as const satisfies Pick<DiscoveryFiltersDto, "ageMin" | "ageMax" | "locationScope" | "locationId" | "heightMinCm" | "heightMaxCm" | "education">;

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
    canDate: canDate(user?.gender ?? null),
    hasDatingIntent: Boolean(profile?.intent),
    ownAge: user?.dateOfBirth ? ageFromDateOfBirth(user.dateOfBirth, now) : null,
    ageMin: prefs?.ageMin ?? DEFAULT_FILTERS.ageMin,
    ageMax: prefs?.ageMax ?? DEFAULT_FILTERS.ageMax,
    locationScope: prefs?.locationScope ?? "ANYWHERE",
    locationId: prefs?.locationId ?? null,
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
    db.discoveryPreferences.findUnique({ where: { userId: actor.userId }, select: { connectionIntent: true } }),
    db.profile.findUnique({ where: { userId: actor.userId }, select: { intent: true } }),
  ]);
  const advanced = entitlements.rules.canUseAdvancedFilters;
  const dating = datingFieldsApply(f.connectionIntent);

  /*
   * The pool is the member's choice; who they see in it is not a choice at all (Dating: opposite gender, Friendship:
   * everyone in the pool), so nothing in the request can widen or narrow a deck by gender.
   *
   * Only the pool is written; the legacy "Show me" columns are never touched. A switch INTO Dating is refused for a
   * gender that has no Dating match. A legacy member already stored on Dating can still save their other filters.
   */
  if (existing?.connectionIntent !== f.connectionIntent) assertPoolAllowed(user.gender, f.connectionIntent);

  /*
   * The member's own "What are you looking for?" answer, when they come into Dating without one (somebody who onboarded
   * through Friendship was never asked). Optional: it is shown on their profile, and a missing answer hides nobody.
   */
  const myIntent = dating && !profile?.intent ? (f.myIntent ?? null) : null;

  const row = {
    connectionIntent: f.connectionIntent,
    ageMin: f.ageMin,
    ageMax: f.ageMax,
    locationScope: f.locationScope,
    locationId: f.locationScope === "SPECIFIC" ? f.locationId! : null,
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

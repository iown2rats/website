/**
 * Discovery read models built on the shared predicate (docs/ARCHITECTURE.md §7).
 */
import { Prisma } from "@/generated/prisma/client";
import { DISCOVERY } from "@/config/product";
import { ageFromDateOfBirth } from "@/lib/age";
import type { DbLike } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";
import { baseVisibleSql, compatibilitySql, discoverableSql, notSwipedSql, orderSql, viewerFilterSql, type ViewerContext } from "./predicate";

/** Loads everything the predicate needs to know about the viewer. */
export async function loadViewerContext(db: DbLike, userId: string, now: Date): Promise<ViewerContext> {
  const [user, prefs, entitlements] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { phoneHash: true, gender: true, dateOfBirth: true, profile: { select: { location: { select: { atollCode: true } } } } },
    }),
    db.discoveryPreferences.findUnique({ where: { userId } }),
    getEntitlements(db, userId, now),
  ]);
  if (!user) throw new NotFoundError("User");
  return {
    userId,
    phoneHash: user.phoneHash,
    gender: user.gender,
    age: user.dateOfBirth ? ageFromDateOfBirth(user.dateOfBirth, now) : null,
    interestedIn: prefs?.interestedIn ?? "EVERYONE",
    ageMin: prefs?.ageMin ?? 18,
    ageMax: prefs?.ageMax ?? 99,
    intent: prefs?.intent ?? null,
    locationScope: prefs?.locationScope ?? "ANYWHERE",
    locationId: prefs?.locationId ?? null,
    atollCode: user.profile?.location?.atollCode ?? null,
    advancedFilters: entitlements.rules.canUseAdvancedFilters,
    heightMinCm: prefs?.heightMinCm ?? null,
    heightMaxCm: prefs?.heightMaxCm ?? null,
    education: prefs?.education ?? null,
  };
}

export interface DeckQueryOptions {
  limit?: number;
  now?: Date;
  /** Candidates the client is still holding; excluded so adjacent batches never overlap. */
  excludeIds?: string[];
}

const FROM_CLAUSE = Prisma.sql`
  FROM "User" u
  JOIN "Profile" p ON p."userId" = u.id
  JOIN "PrivacySettings" ps ON ps."userId" = u.id
  JOIN "DiscoveryPreferences" cp ON cp."userId" = u.id
  LEFT JOIN "Location" loc ON loc.id = p."locationId"
  LEFT JOIN "Verification" ver ON ver."userId" = u.id
`;

function excludeSql(ids: string[]): Prisma.Sql {
  if (ids.length === 0) return Prisma.sql`TRUE`;
  return Prisma.sql`u.id NOT IN (${Prisma.join(ids)})`;
}

/** Candidate user ids for the deck, in ranking order. Profiles are hydrated separately into DTOs. */
export async function getDeckCandidateIds(db: DbLike, actor: Actor, options: DeckQueryOptions = {}): Promise<string[]> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? DISCOVERY.batchSize, 1), DISCOVERY.maxBatchSize);
  const exclude = (options.excludeIds ?? []).slice(0, DISCOVERY.maxExcludeHandles);
  const v = await loadViewerContext(db, actor.userId, now);
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u.id
    ${FROM_CLAUSE}
    WHERE ${baseVisibleSql(v.userId, v.phoneHash, now)}
      AND ${discoverableSql()}
      AND ${compatibilitySql(v)}
      AND ${viewerFilterSql(v, now)}
      AND ${notSwipedSql(v.userId, now)}
      AND ${excludeSql(exclude)}
    ORDER BY ${orderSql(v.userId, now)}
    LIMIT ${limit}
  `);
  return rows.map((r) => r.id);
}

/**
 * How many compatible, unswiped people exist if the viewer's own filters (age range, intent, location, advanced)
 * were lifted. Used only to tell an empty deck apart from an over-restrictive one; never returns identities.
 */
export async function countRelaxedCandidates(db: DbLike, actor: Actor, now: Date = new Date()): Promise<number> {
  const v = await loadViewerContext(db, actor.userId, now);
  const rows = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(*)::bigint AS n
    ${FROM_CLAUSE}
    WHERE ${baseVisibleSql(v.userId, v.phoneHash, now)}
      AND ${discoverableSql()}
      AND ${compatibilitySql(v)}
      AND ${notSwipedSql(v.userId, now)}
  `);
  return Number(rows[0]?.n ?? 0);
}

/**
 * May the viewer see this specific user at all (blocks, contact hashes, Invisible Mode, account state)?
 * Filters and swipe history are deliberately not applied: this guards likes, profile views and Likes You.
 */
export async function canView(db: DbLike, viewerId: string, candidateId: string, now: Date = new Date()): Promise<boolean> {
  const viewer = await db.user.findUnique({ where: { id: viewerId }, select: { phoneHash: true } });
  if (!viewer) return false;
  const rows = await db.$queryRaw<{ ok: number }[]>(Prisma.sql`
    SELECT 1 AS ok
    FROM "User" u
    JOIN "PrivacySettings" ps ON ps."userId" = u.id
    WHERE u.id = ${candidateId} AND ${baseVisibleSql(viewerId, viewer.phoneHash, now)}
    LIMIT 1
  `);
  return rows.length > 0;
}

/** Is this user currently a valid deck candidate for the viewer (visible, discoverable, compatible, unswiped, in filters)? */
export async function isDeckCandidate(db: DbLike, actor: Actor, candidateId: string, now: Date = new Date()): Promise<boolean> {
  const v = await loadViewerContext(db, actor.userId, now);
  const rows = await db.$queryRaw<{ ok: number }[]>(Prisma.sql`
    SELECT 1 AS ok
    ${FROM_CLAUSE}
    WHERE u.id = ${candidateId}
      AND ${baseVisibleSql(v.userId, v.phoneHash, now)}
      AND ${discoverableSql()}
      AND ${compatibilitySql(v)}
      AND ${viewerFilterSql(v, now)}
      AND ${notSwipedSql(v.userId, now)}
    LIMIT 1
  `);
  return rows.length > 0;
}

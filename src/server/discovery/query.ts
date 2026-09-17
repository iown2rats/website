/**
 * Discovery read models built on the shared predicate (docs/ARCHITECTURE.md §7).
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbLike } from "@/lib/db";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";
import { baseVisibleSql, discoverableSql, notSwipedSql, orderSql, preferenceSql, type ViewerContext } from "./predicate";
import { NotFoundError } from "@/lib/errors";

/** Loads everything the predicate needs to know about the viewer. */
export async function loadViewerContext(db: DbLike, userId: string, now: Date): Promise<ViewerContext> {
  const [user, prefs, entitlements] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { phoneHash: true, gender: true, profile: { select: { location: { select: { atollCode: true } } } } },
    }),
    db.discoveryPreferences.findUnique({ where: { userId } }),
    getEntitlements(db, userId, now),
  ]);
  if (!user) throw new NotFoundError("User");
  return {
    userId,
    phoneHash: user.phoneHash,
    gender: user.gender,
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

/** Candidate user ids for the deck, in ranking order. Profiles are hydrated separately into DTOs. */
export async function getDeckCandidateIds(
  db: DbLike,
  actor: Actor,
  options: { limit?: number; now?: Date } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const v = await loadViewerContext(db, actor.userId, now);
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u.id
    FROM "User" u
    JOIN "Profile" p ON p."userId" = u.id
    JOIN "PrivacySettings" ps ON ps."userId" = u.id
    JOIN "DiscoveryPreferences" cp ON cp."userId" = u.id
    LEFT JOIN "Location" loc ON loc.id = p."locationId"
    LEFT JOIN "Verification" ver ON ver."userId" = u.id
    WHERE ${baseVisibleSql(v.userId, v.phoneHash, now)}
      AND ${discoverableSql()}
      AND ${preferenceSql(v, now)}
      AND ${notSwipedSql(v.userId, now)}
    ORDER BY ${orderSql(v.userId, now)}
    LIMIT ${limit}
  `);
  return rows.map((r) => r.id);
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

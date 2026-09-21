/**
 * Social context for a Community post (docs/ARCHITECTURE.md §14.4).
 *
 * Two signals, both counted from rows that already exist:
 *
 *   participants — how many DIFFERENT members have replied, not counting the author, who started the thread
 *                  rather than joining it. This is what "12 people joined this conversation" means.
 *   popularIn    — an island that a clear majority of those repliers share.
 *
 * Nothing here is invented, estimated or padded, and no signal is shown below the thresholds below: a count of 2
 * is not a conversation, and "Popular in Malé" drawn from two people is a guess dressed as a fact. When there is
 * nothing true to say the DTO carries null and the card shows nothing, which is the whole point — the alternative
 * is fabricated activity, which the product rules forbid outright.
 *
 * An island is only ever counted for a member who has NOT hidden their location, and only ever in an aggregate of
 * at least `minIslandParticipants` people, so the label can never be read backwards as "X is in Malé".
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbLike } from "@/lib/db";

export const CONTEXT_RULES = {
  /** Below this, "N people joined" is noise rather than a signal. */
  minParticipants: 3,
  /** An island label needs this many located repliers behind it before it can be shown at all. */
  minIslandParticipants: 3,
  /** …and that island must hold at least this share of the located repliers. */
  islandShare: 0.6,
} as const;

export interface PostContextDto {
  /** Distinct members who replied, excluding the author. Counted, never listed. */
  participants: number;
  /** An island a clear majority of those repliers share, or null. */
  popularIn: string | null;
}

type ContextRow = {
  postId: string;
  participants: number;
  island: string | null;
  islandCount: number | null;
  locatedCount: number | null;
};

/**
 * One query for a whole feed page. `DISTINCT ON` picks each post's leading island; ties break on the name so the
 * answer is stable between requests rather than flipping with the plan.
 */
export async function loadPostContext(db: DbLike, postIds: string[]): Promise<Map<string, PostContextDto>> {
  const out = new Map<string, PostContextDto>();
  if (postIds.length === 0) return out;
  const ids = Prisma.join(postIds);
  const rows = await db.$queryRaw<ContextRow[]>(Prisma.sql`
    WITH repliers AS (
      SELECT DISTINCT c."postId", c."authorId"
      FROM "CommunityComment" c
      JOIN "CommunityPost" p ON p.id = c."postId"
      JOIN "User" u ON u.id = c."authorId"
      WHERE c."postId" IN (${ids})
        AND c."deletedAt" IS NULL
        AND c."authorId" <> p."authorId"
        AND u."accountType" = 'MEMBER' AND u."deletedAt" IS NULL
    ),
    totals AS (SELECT "postId", COUNT(*)::int AS participants FROM repliers GROUP BY "postId"),
    islands AS (
      SELECT r."postId", l.name AS island, COUNT(*)::int AS n
      FROM repliers r
      JOIN "Profile" pr ON pr."userId" = r."authorId"
      JOIN "PrivacySettings" ps ON ps."userId" = r."authorId"
      JOIN "Location" l ON l.id = pr."locationId"
      WHERE ps."hideLocation" = FALSE
      GROUP BY r."postId", l.name
    ),
    located AS (SELECT "postId", SUM(n)::int AS n FROM islands GROUP BY "postId"),
    top AS (SELECT DISTINCT ON ("postId") "postId", island, n FROM islands ORDER BY "postId", n DESC, island ASC)
    SELECT t."postId"       AS "postId",
           t.participants   AS "participants",
           top.island       AS "island",
           top.n            AS "islandCount",
           located.n        AS "locatedCount"
    FROM totals t
    LEFT JOIN top ON top."postId" = t."postId"
    LEFT JOIN located ON located."postId" = t."postId"
  `);

  for (const row of rows) {
    if (row.participants < CONTEXT_RULES.minParticipants) continue;
    const located = row.locatedCount ?? 0;
    const leading = row.islandCount ?? 0;
    const popularIn =
      row.island && leading >= CONTEXT_RULES.minIslandParticipants && located > 0 && leading / located >= CONTEXT_RULES.islandShare ? row.island : null;
    out.set(row.postId, { participants: row.participants, popularIn });
  }
  return out;
}

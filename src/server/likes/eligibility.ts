/**
 * The one rule for "may this viewer see that this person liked them" (docs/ARCHITECTURE.md §12.5).
 *
 * Three surfaces ask that question — the Likes You grid, its count and the Discover aside, and the notification
 * feed's decision to print a liker's name — and before this module they each answered it separately. They
 * disagreed, and a paying member found out: he had passed somebody in Discover, she liked him six hours later, his
 * notification unlocked her name the moment he bought Plus, and Likes You showed him nothing, because that page
 * excluded anyone he had already swiped on. He paid to be told a name the product had decided to withhold.
 *
 * So there is now exactly one predicate and one query, and every surface calls it. A row can no longer name
 * somebody the grid refuses to show.
 *
 * THE PASS RULE. A pass suppresses an incoming like only when the pass came *after* it:
 *
 *     pass."createdAt" > like."createdAt"
 *
 * The order is the whole point. Passing somebody *after* they liked you is a real "no" — you were told, and it
 * sticks. Passing them *before* they liked you was a decision made without that information, and on this app that
 * information is the thing behind the paywall. Letting a blind swipe silently cancel a later like meant selling
 * somebody a feature and then hiding its only content from them.
 *
 * Passes are not checked for expiry here, matching the behaviour this module replaces: a pass that has lapsed back
 * into the deck still suppresses a like it followed.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbLike } from "@/lib/db";
import { baseVisibleSql } from "@/server/discovery/predicate";

export interface EligibleLiker {
  id: string;
  /** Blurhash of the liker's first APPROVED photo, or null when they have none. */
  blurhash: string | null;
  verified: boolean;
}

export interface EligibilityOptions {
  /** Cap on rows returned. Omit for the callers that only need a membership test. */
  limit?: number;
  /** Restrict to these likers, for callers holding a page of notifications rather than the whole list. */
  onlyLikerIds?: string[];
  /** Only likes that landed strictly after this instant (the likes digest: "new since the last one"). */
  likedAfter?: Date;
  /** Only likes that landed strictly before this instant (the likes digest: "settled"). */
  likedBefore?: Date;
}

/**
 * Everyone who has liked the viewer and is still theirs to act on: visible under the base predicate (blocks,
 * contact hashes, account state, Invisible Mode), not already liked back, and not passed since the like landed.
 *
 * Ordered newest like first, which is the order Likes You shows.
 */
export async function listEligibleIncomingLikes(db: DbLike, viewerId: string, now: Date, options: EligibilityOptions = {}): Promise<EligibleLiker[]> {
  if (options.onlyLikerIds?.length === 0) return [];
  const viewer = await db.user.findUniqueOrThrow({ where: { id: viewerId }, select: { phoneHash: true } });
  const restrict = options.onlyLikerIds?.length
    ? Prisma.sql`AND u.id IN (${Prisma.join(options.onlyLikerIds)})`
    : Prisma.empty;
  const limit = options.limit != null ? Prisma.sql`LIMIT ${Math.min(options.limit, 100)}` : Prisma.empty;
  // Time bounds narrow WHICH likes are asked about; they never change what makes a like eligible.
  const after = options.likedAfter ? Prisma.sql`AND l."createdAt" > ${options.likedAfter}` : Prisma.empty;
  const before = options.likedBefore ? Prisma.sql`AND l."createdAt" < ${options.likedBefore}` : Prisma.empty;

  return db.$queryRaw<EligibleLiker[]>(Prisma.sql`
    SELECT u.id,
           (COALESCE(ver.status::text, '') = 'VERIFIED') AS verified,
           -- APPROVED only, whatever PHOTO_VISIBILITY_POLICY says: a pending or rejected photo must not reach a Free
           -- viewer even as a 32-pixel colour wash. No approved photo → null → the plain placeholder tile.
           (SELECT ph.blurhash FROM "ProfilePhoto" ph JOIN "Profile" pp ON pp.id = ph."profileId"
             WHERE pp."userId" = u.id AND ph.moderation = 'APPROVED' ORDER BY ph.position ASC LIMIT 1) AS blurhash
    FROM "Like" l
    JOIN "User" u ON u.id = l."fromUserId"
    JOIN "PrivacySettings" ps ON ps."userId" = u.id
    LEFT JOIN "Verification" ver ON ver."userId" = u.id
    WHERE l."toUserId" = ${viewerId}
      ${restrict}
      ${after}
      ${before}
      AND ${baseVisibleSql(viewerId, viewer.phoneHash, now)}
      AND NOT EXISTS (SELECT 1 FROM "Like" back WHERE back."fromUserId" = ${viewerId} AND back."toUserId" = u.id)
      AND NOT EXISTS (
        SELECT 1 FROM "Pass" pa
        WHERE pa."fromUserId" = ${viewerId} AND pa."toUserId" = u.id
          AND pa."undoneAt" IS NULL
          -- Only a pass made AFTER the like counts. See THE PASS RULE above.
          AND pa."createdAt" > l."createdAt"
      )
    ORDER BY l."createdAt" DESC
    ${limit}
  `);
}

/**
 * Which of `likerIds` the viewer may currently be told about by name. Used by the notification feed and the
 * Discover aside, so a row that names somebody is always a row whose subject is on the Likes You page.
 *
 * The entitlement is the CALLER's question: this answers eligibility, not whether the viewer has paid.
 */
export async function nameableLikers(db: DbLike, viewerId: string, likerIds: string[], now: Date): Promise<Set<string>> {
  if (likerIds.length === 0) return new Set();
  const unique = [...new Set(likerIds)];
  const rows = await listEligibleIncomingLikes(db, viewerId, now, { onlyLikerIds: unique });
  return new Set(rows.map((r) => r.id));
}

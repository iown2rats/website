/**
 * Likes You read model (docs/ARCHITECTURE.md §12.5).
 * Free: count + anonymised placeholders with no identifying fields.
 * Plus: full visible profiles.
 */
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/lib/db";
import type { Actor } from "@/server/actor";
import { baseVisibleSql } from "@/server/discovery/predicate";
import { getEntitlements } from "@/server/entitlements";
import { buildVisibleProfiles, type VisibleProfile } from "@/server/profiles/visible-profile";

export interface LikesYouPlaceholder {
  /** Precomputed blurhash of the liker's primary photo, or null when they have none. */
  blurhash: string | null;
  verified: boolean;
}

export type LikesYouResult =
  | { tier: "FREE"; count: number; placeholders: LikesYouPlaceholder[] }
  | { tier: "PLUS"; count: number; profiles: VisibleProfile[] };

/**
 * People who liked the actor and whom the actor has not yet liked back or passed, filtered through
 * the base visibility predicate (blocks, contact hashes, account state).
 */
export async function getLikesYou(actor: Actor, options: { now?: Date; db?: Db; limit?: number } = {}): Promise<LikesYouResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const limit = Math.min(options.limit ?? 50, 100);

  const viewer = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { phoneHash: true } });
  const likerRows = await db.$queryRaw<{ id: string; verified: boolean; blurhash: string | null }[]>(Prisma.sql`
    SELECT u.id,
           (COALESCE(ver.status::text, '') = 'VERIFIED') AS verified,
           (SELECT ph.blurhash FROM "ProfilePhoto" ph JOIN "Profile" pp ON pp.id = ph."profileId"
             WHERE pp."userId" = u.id ORDER BY ph.position ASC LIMIT 1) AS blurhash
    FROM "Like" l
    JOIN "User" u ON u.id = l."fromUserId"
    JOIN "PrivacySettings" ps ON ps."userId" = u.id
    LEFT JOIN "Verification" ver ON ver."userId" = u.id
    WHERE l."toUserId" = ${actor.userId}
      AND ${baseVisibleSql(actor.userId, viewer.phoneHash, now)}
      AND NOT EXISTS (SELECT 1 FROM "Like" back WHERE back."fromUserId" = ${actor.userId} AND back."toUserId" = u.id)
      AND NOT EXISTS (SELECT 1 FROM "Pass" pa WHERE pa."fromUserId" = ${actor.userId} AND pa."toUserId" = u.id AND pa."undoneAt" IS NULL)
    ORDER BY l."createdAt" DESC
    LIMIT ${limit}
  `);

  const entitlements = await getEntitlements(db, actor.userId, now);
  if (!entitlements.rules.canSeeIncomingLikes) {
    // Randomise so placeholder order cannot be correlated with any other list.
    const placeholders = likerRows
      .map((r) => ({ blurhash: r.blurhash, verified: r.verified }))
      .sort(() => Math.random() - 0.5);
    return { tier: "FREE", count: likerRows.length, placeholders };
  }

  const profiles = await buildVisibleProfiles(db, actor.userId, likerRows.map((r) => r.id), now);
  return { tier: "PLUS", count: likerRows.length, profiles };
}

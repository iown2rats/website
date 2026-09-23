/**
 * Likes You read model (docs/ARCHITECTURE.md §12.5).
 * Free: count + anonymised placeholders with no identifying fields.
 * Plus: full visible profiles.
 */
import { getDb, type Db } from "@/lib/db";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";
import { buildVisibleProfiles, type VisibleProfile } from "@/server/profiles/visible-profile";
import { listEligibleIncomingLikes } from "./eligibility";

export interface LikesYouPlaceholder {
  /** Precomputed blurhash of the liker's primary photo, or null when they have none. */
  blurhash: string | null;
  verified: boolean;
}

export type LikesYouResult =
  | { tier: "FREE"; count: number; placeholders: LikesYouPlaceholder[] }
  | { tier: "PLUS"; count: number; profiles: VisibleProfile[] };

/**
 * People who liked the actor and are still theirs to act on. Eligibility — including the rule that a pass only
 * suppresses a like it followed — lives in `./eligibility`; this function only decides what the tier may see.
 */
export async function getLikesYou(actor: Actor, options: { now?: Date; db?: Db; limit?: number } = {}): Promise<LikesYouResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  // One rule, shared with the notification feed and the Discover aside, so they cannot disagree (see
  // src/server/likes/eligibility.ts).
  const likerRows = await listEligibleIncomingLikes(db, actor.userId, now, { limit: options.limit ?? 50 });

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

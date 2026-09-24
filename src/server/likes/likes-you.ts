/**
 * Likes You read model (docs/ARCHITECTURE.md §12.5).
 * Free: count + anonymised placeholders with no identifying fields.
 * Plus: full visible profiles.
 */
import { getDb, type Db } from "@/lib/db";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";
import { buildVisibleProfiles, type VisibleProfile } from "@/server/profiles/visible-profile";
import { countEligibleIncomingLikes, listEligibleIncomingLikes } from "./eligibility";

export interface LikesYouPlaceholder {
  /** Blurhash of the liker's first APPROVED photo (never a pending or rejected one), or null when they have none. */
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
  const [likerRows, count] = await Promise.all([
    listEligibleIncomingLikes(db, actor.userId, now, { limit: options.limit ?? 50 }),
    // The number the member is told comes from the same rule, uncapped: the list stops at one page, the count doesn't.
    countEligibleIncomingLikes(db, actor.userId, now),
  ]);

  const entitlements = await getEntitlements(db, actor.userId, now);
  if (!entitlements.rules.canSeeIncomingLikes) {
    // Randomise so placeholder order cannot be correlated with any other list.
    const placeholders = likerRows
      .map((r) => ({ blurhash: r.blurhash, verified: r.verified }))
      .sort(() => Math.random() - 0.5);
    return { tier: "FREE", count, placeholders };
  }

  const profiles = await buildVisibleProfiles(db, actor.userId, likerRows.map((r) => r.id), now);
  return { tier: "PLUS", count, profiles };
}

/**
 * The personalised Plus prompt's number, for surfaces outside Likes You (Discover, Membership).
 *
 * Null for anyone who can already see their likers — a Plus member is never shown the Free upsell — and the real
 * count otherwise, which may be zero. Callers must treat zero as "say nothing personal": no surface may imply that
 * somebody likes a member unless this number says so. It carries no identities, by construction.
 */
export async function getLikesTeaser(actor: Actor, options: { now?: Date; db?: Db } = {}): Promise<{ count: number } | null> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const entitlements = await getEntitlements(db, actor.userId, now);
  if (entitlements.rules.canSeeIncomingLikes) return null;
  return { count: await countEligibleIncomingLikes(db, actor.userId, now) };
}

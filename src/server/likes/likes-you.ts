/**
 * Likes You read model (docs/ARCHITECTURE.md §12.5).
 * Free: the count, and nothing else about anybody.
 * Plus: full visible profiles.
 */
import { getDb, type Db } from "@/lib/db";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";
import { buildVisibleProfiles, type VisibleProfile } from "@/server/profiles/visible-profile";
import { countEligibleIncomingLikes, countEligibleIncomingLikesByKind, listEligibleIncomingLikes } from "./eligibility";

/** How many profiles one Likes You or Sent page carries. The counts are never capped; see `LIKES_PAGE_SIZE` uses. */
export const LIKES_PAGE_SIZE = 100;

/*
 * The Free result is a number and nothing more. It used to carry, per liker, the blurhash of their first photo and
 * their verified flag "for the blurred tile" — but the Discover deck ships every candidate's blurhash too, so a Free
 * member could match the two strings in their own browser and learn exactly who liked them. The locked tiles are
 * now drawn from no data at all: the server cannot leak what it does not send.
 */
export type LikesYouResult =
  | {
      tier: "FREE";
      count: number;
      /**
       * How many of `count` are Super Likes, and how many of those carry a message (§12.20). Counts of the viewer's
       * own inbox only: no sender, no text, no order that lines up with anything else the member receives.
       */
      superLikes: number;
      superLikesWithMessage: number;
    }
  | {
      tier: "PLUS";
      count: number;
      profiles: VisibleProfile[];
      /** The Super Likes among `profiles`, by user id, with their message. Absent ids are ordinary likes. */
      superLikes: Map<string, { message: string | null }>;
    };

/**
 * People who liked the actor and are still theirs to act on. Eligibility — including the rule that a pass only
 * suppresses a like it followed — lives in `./eligibility`; this function only decides what the tier may see.
 */
export async function getLikesYou(actor: Actor, options: { now?: Date; db?: Db; limit?: number } = {}): Promise<LikesYouResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  // One rule, shared with the notification feed and the Discover aside, so they cannot disagree (see
  // src/server/likes/eligibility.ts).
  const entitlements = await getEntitlements(db, actor.userId, now);
  // Free: not even the ids are read. There is nothing per-person to put in the response — including a Super Like's
  // message, which would identify its sender as surely as a name would.
  if (!entitlements.rules.canSeeIncomingLikes) {
    const counts = await countEligibleIncomingLikesByKind(db, actor.userId, now);
    return { tier: "FREE", count: counts.total, superLikes: counts.superLikes, superLikesWithMessage: counts.superLikesWithMessage };
  }

  // The number the member is told comes from the same rule as the list, uncapped: the list stops at one page.
  const [count, likerRows] = await Promise.all([
    countEligibleIncomingLikes(db, actor.userId, now),
    listEligibleIncomingLikes(db, actor.userId, now, { limit: options.limit ?? LIKES_PAGE_SIZE }),
  ]);
  const profiles = await buildVisibleProfiles(db, actor.userId, likerRows.map((r) => r.id), now);
  const superLikes = new Map(likerRows.filter((r) => r.superLike).map((r) => [r.id, { message: r.message }] as const));
  return { tier: "PLUS", count, profiles, superLikes };
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

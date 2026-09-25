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
 * THE DISMISSAL RULE. A Discover pass never hides an incoming like, whenever it was made. Only the recipient's
 * explicit "no" on Likes You does — `Like.dismissedAt`, set by a Pass tapped on that page (`passUser` with
 * `dismissIncomingLike`).
 *
 * Discover never says that a card has liked you, so every pass made there is blind to the like, before it or after
 * it. The rule this replaces let a pass made AFTER the like hide it, on the theory that the member had been told;
 * in production 28 of the 29 likes it hid belonged to Free members, who had been told only "Someone liked you" and
 * then, hours later, passed that very person in Discover without knowing. They were left with a notification and an
 * empty page. A pass still does what a pass does — keeps the person out of the deck for 30 days — and nothing more.
 *
 * THE POOL RULE. A like is shown only while its sender is in the viewer's pool (Dating or Friendship,
 * docs/ARCHITECTURE.md §7.5). Somebody who liked you on Dating and has since moved to Friendship would otherwise
 * sit on your page with one button — like back — that the server must refuse, because new likes never cross pools.
 * The like itself is kept as it was: nothing is deleted, and it reappears if the two of you are ever in the same
 * pool again. Existing matches are a different list and are never affected by a pool change.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbLike } from "@/lib/db";
import { baseVisibleSql } from "@/server/discovery/predicate";

export interface EligibleLiker {
  id: string;
  /** A Super Like (§12.20). */
  superLike: boolean;
  /**
   * The Super Like's message, or null. Server-side only until a caller decides the viewer may have it: the Plus
   * Likes You page, the sender's own Sent list. The Free Likes You path never reads this list at all.
   */
  message: string | null;
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
 * contact hashes, account state, Invisible Mode), in the viewer's pool, not already liked back (so never a match),
 * and not dismissed on Likes You.
 *
 * Ordered newest like first, which is the order Likes You shows.
 */
export async function listEligibleIncomingLikes(db: DbLike, viewerId: string, now: Date, options: EligibilityOptions = {}): Promise<EligibleLiker[]> {
  if (options.onlyLikerIds?.length === 0) return [];
  const eligible = await eligibleLikesSql(db, viewerId, now, options);
  const limit = options.limit != null ? Prisma.sql`LIMIT ${Math.min(options.limit, 100)}` : Prisma.empty;

  // Super Likes first (§12.20), then newest; `u.id` makes the order total, so repeated loads never reshuffle.
  // The Free page never calls this: it carries no per-person data at all (src/server/likes/likes-you.ts).
  return db.$queryRaw<EligibleLiker[]>(Prisma.sql`
    SELECT u.id, (l.kind = 'SUPER') AS "superLike", i.body AS message
    ${eligible}
    ORDER BY (l.kind = 'SUPER') DESC, l."createdAt" DESC, u.id
    ${limit}
  `);
}

/**
 * How many people are on the viewer's Likes You page — the same FROM/WHERE as the list, counted rather than capped.
 * The list is limited to what one page renders; the number a member is told ("4 people like you") must not be.
 */
export async function countEligibleIncomingLikes(db: DbLike, viewerId: string, now: Date): Promise<number> {
  return (await countEligibleIncomingLikesByKind(db, viewerId, now)).total;
}

/**
 * The same count split by kind, for the Free page's locked Super Like tiles ("Someone Super Liked you ⭐", "They sent
 * you a message"). Three numbers about the viewer's own inbox — nothing about who, and nothing that appears in any
 * other payload, so there is nothing to correlate.
 */
export async function countEligibleIncomingLikesByKind(db: DbLike, viewerId: string, now: Date): Promise<{ total: number; superLikes: number; superLikesWithMessage: number }> {
  const eligible = await eligibleLikesSql(db, viewerId, now, {});
  const rows = await db.$queryRaw<{ n: bigint | number; s: bigint | number; m: bigint | number }[]>(Prisma.sql`
    SELECT count(*) AS n,
           count(*) FILTER (WHERE l.kind = 'SUPER') AS s,
           count(*) FILTER (WHERE l.kind = 'SUPER' AND i.id IS NOT NULL) AS m
    ${eligible}
  `);
  const r = rows[0];
  return { total: Number(r?.n ?? 0), superLikes: Number(r?.s ?? 0), superLikesWithMessage: Number(r?.m ?? 0) };
}

/**
 * THE rule, as SQL: the FROM and WHERE both the list and the count run, so they cannot drift apart. Every exclusion
 * lives here and nowhere else.
 */
async function eligibleLikesSql(db: DbLike, viewerId: string, now: Date, options: EligibilityOptions): Promise<Prisma.Sql> {
  const viewer = await db.user.findUniqueOrThrow({ where: { id: viewerId }, select: { phoneHash: true } });
  const restrict = options.onlyLikerIds?.length
    ? Prisma.sql`AND u.id IN (${Prisma.join(options.onlyLikerIds)})`
    : Prisma.empty;
  // Time bounds narrow WHICH likes are asked about; they never change what makes a like eligible.
  const after = options.likedAfter ? Prisma.sql`AND l."createdAt" > ${options.likedAfter}` : Prisma.empty;
  const before = options.likedBefore ? Prisma.sql`AND l."createdAt" < ${options.likedBefore}` : Prisma.empty;
  return Prisma.sql`
    FROM "Like" l
    LEFT JOIN "Intro" i ON i.id = l."introId"
    JOIN "User" u ON u.id = l."fromUserId"
    -- Profile is joined so the count can only ever include people the page can render (buildVisibleProfiles needs one).
    JOIN "Profile" p ON p."userId" = u.id
    JOIN "PrivacySettings" ps ON ps."userId" = u.id
    JOIN "DiscoveryPreferences" lp ON lp."userId" = u.id
    WHERE l."toUserId" = ${viewerId}
      ${restrict}
      -- Same pool only (THE POOL RULE above): a like whose sender is now in the other pool stays stored, untouched,
      -- and comes back if the two are ever in the same pool again. It is never shown in between, because the only
      -- thing a Likes You tile offers is a like back, and a like may not cross pools (src/server/likes/like.ts).
      AND lp."connectionIntent" = COALESCE(
        (SELECT vp."connectionIntent" FROM "DiscoveryPreferences" vp WHERE vp."userId" = ${viewerId}),
        'DATING'::"ConnectionIntent"
      )
      ${after}
      ${before}
      AND ${baseVisibleSql(viewerId, viewer.phoneHash, now)}
      AND NOT EXISTS (SELECT 1 FROM "Like" back WHERE back."fromUserId" = ${viewerId} AND back."toUserId" = u.id)
      AND NOT EXISTS (
        SELECT 1 FROM "Match" m
        WHERE (m."userAId" = ${viewerId} AND m."userBId" = u.id) OR (m."userAId" = u.id AND m."userBId" = ${viewerId})
      )
      -- THE DISMISSAL RULE above: only a "no" said on Likes You hides a like. Discover passes are not consulted.
      AND l."dismissedAt" IS NULL
  `;
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

/**
 * SENT: the people the viewer has liked who have not become a match (docs/ARCHITECTURE.md §12.5). One SQL for the
 * list and the count, as with Likes You, so "Sent (7)" always renders seven cards.
 *
 * What removes somebody from Sent is only what removes them everywhere: a match in any state (they liked back, or
 * the pair was since unmatched — either way it is no longer a pending like), the base predicate (a block either
 * way, contact hashes, an account that is suspended, banned, deleted or not a member, Invisible Mode), and the pool
 * rule, for the same reason Likes You applies it: a like across pools can never become a match while they differ,
 * and a Dating member is never shown Friendship profiles. The pool rule hides; it never deletes, and the card comes
 * back if the two are in the same pool again.
 *
 * Deliberately NOT consulted: anything the other person did about the like — a pass, a Likes You dismissal. Sent
 * is the sender's own list, and it must not become a way to learn a "no".
 */
export async function listSentLikes(db: DbLike, viewerId: string, now: Date, options: { limit?: number } = {}): Promise<EligibleLiker[]> {
  const sent = await sentLikesSql(db, viewerId, now);
  const limit = options.limit != null ? Prisma.sql`LIMIT ${Math.min(options.limit, 100)}` : Prisma.empty;
  // Newest first; the message is the sender's own, so returning it here is returning them their own words.
  return db.$queryRaw<EligibleLiker[]>(Prisma.sql`SELECT u.id, (l.kind = 'SUPER') AS "superLike", i.body AS message ${sent} ORDER BY l."createdAt" DESC, u.id ${limit}`);
}

export async function countSentLikes(db: DbLike, viewerId: string, now: Date): Promise<number> {
  const sent = await sentLikesSql(db, viewerId, now);
  const rows = await db.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT count(*) AS n ${sent}`);
  return Number(rows[0]?.n ?? 0);
}

async function sentLikesSql(db: DbLike, viewerId: string, now: Date): Promise<Prisma.Sql> {
  const viewer = await db.user.findUniqueOrThrow({ where: { id: viewerId }, select: { phoneHash: true } });
  return Prisma.sql`
    FROM "Like" l
    LEFT JOIN "Intro" i ON i.id = l."introId"
    JOIN "User" u ON u.id = l."toUserId"
    JOIN "Profile" p ON p."userId" = u.id
    JOIN "PrivacySettings" ps ON ps."userId" = u.id
    JOIN "DiscoveryPreferences" tp ON tp."userId" = u.id
    WHERE l."fromUserId" = ${viewerId}
      AND tp."connectionIntent" = COALESCE(
        (SELECT vp."connectionIntent" FROM "DiscoveryPreferences" vp WHERE vp."userId" = ${viewerId}),
        'DATING'::"ConnectionIntent"
      )
      AND ${baseVisibleSql(viewerId, viewer.phoneHash, now)}
      AND NOT EXISTS (
        SELECT 1 FROM "Match" m
        WHERE (m."userAId" = ${viewerId} AND m."userBId" = u.id) OR (m."userAId" = u.id AND m."userBId" = ${viewerId})
      )
      -- Mutual likes always become a match; this only guards a malformed pair from reading as "pending".
      AND NOT EXISTS (SELECT 1 FROM "Like" back WHERE back."fromUserId" = u.id AND back."toUserId" = ${viewerId})
  `;
}

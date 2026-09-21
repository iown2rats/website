/**
 * The modules that sit beside the feed (docs/ARCHITECTURE.md §14.5): "🔥 Popular today", people worth following,
 * and which topics are actually busy. They exist so that a thin feed is still a useful screen instead of a blank
 * one followed by "You're all caught up."
 *
 * Every number here is counted from rows. There is no seeding, no placeholder activity and no "trending" score
 * invented to make the screen look busier than the community is: each query has a floor, and when the floor is not
 * met the module returns nothing and the UI omits it. A quiet Community should look quiet and offer something to
 * do, not look busy and lie about it.
 *
 * Everything runs through the same `postVisibleSql` as the feed, so blocks, contact blocks, deleted and suspended
 * accounts and unreviewed photos are handled once rather than re-implemented per module.
 */
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { loadAuthors, type CommunityAuthorDto, type CommunityPostKind } from "./dto";
import { postVisibleSql, viewerHash } from "./feed";
import { CONVERSATION_STARTERS } from "./rules";
import { TOPICS, type TopicKey } from "./topics";

export { CONVERSATION_STARTERS };

const HOUR = 3_600_000;

export const DISCOVER_RULES = {
  /** "Popular today" means today. */
  popularWindowMs: 24 * HOUR,
  /** A post with one reply is not a discussion. */
  popularMinComments: 2,
  /** The spec asks for 2-3; below `popularMin` the module is not shown at all. */
  popularMin: 2,
  popularMax: 3,
  /** How far back "posts here lately" reaches when suggesting someone to follow. */
  suggestWindowMs: 14 * 24 * HOUR,
  suggestMax: 3,
  /** Which chips are busy right now. */
  activeTopicWindowMs: 7 * 24 * HOUR,
  /** Characters of the body shown in the Popular today list. */
  excerptLength: 90,
} as const;

export interface PopularPostDto {
  id: string;
  /** A trimmed single line of the body. No author: the module never attributes, so confessions are safe in it. */
  excerpt: string;
  kind: CommunityPostKind;
  topic: TopicKey | null;
  commentCount: number;
  likeCount: number;
}

export interface SuggestedMemberDto {
  author: CommunityAuthorDto;
  /** Posts this member has made in the window — the honest reason they are being suggested. */
  recentPosts: number;
}

export interface ActiveTopicDto {
  key: TopicKey;
  label: string;
  posts: number;
}

export interface CommunityDiscoverDto {
  popular: PopularPostDto[];
  suggestions: SuggestedMemberDto[];
  activeTopics: ActiveTopicDto[];
}


function excerpt(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length <= DISCOVER_RULES.excerptLength ? line : `${line.slice(0, DISCOVER_RULES.excerptLength - 1).trimEnd()}…`;
}

/** The busiest visible discussions of the last day. Fewer than `popularMin` of them means: show nothing. */
export async function getPopularToday(db: DbLike, actor: Actor, now: Date, hash: Uint8Array | null): Promise<PopularPostDto[]> {
  const rows = await db.$queryRaw<{ id: string; body: string; kind: CommunityPostKind; topic: TopicKey | null; commentCount: number; likeCount: number }[]>(Prisma.sql`
    SELECT p.id, p.body, p.kind::text AS kind, p.topic::text AS topic, p."commentCount", p."likeCount"
    FROM "CommunityPost" p
    JOIN "User" u ON u.id = p."authorId"
    WHERE ${postVisibleSql(actor.userId, hash)}
      AND p."createdAt" > ${new Date(now.getTime() - DISCOVER_RULES.popularWindowMs)}
      AND p."commentCount" >= ${DISCOVER_RULES.popularMinComments}
    ORDER BY p."commentCount" DESC, p."likeCount" DESC, p."createdAt" DESC
    LIMIT ${DISCOVER_RULES.popularMax}
  `);
  if (rows.length < DISCOVER_RULES.popularMin) return [];
  return rows.map((r) => ({ id: r.id, excerpt: excerpt(r.body), kind: r.kind, topic: r.topic, commentCount: r.commentCount, likeCount: r.likeCount }));
}

/**
 * Members whose posts the viewer can already see, who post regularly and whom the viewer does not follow yet.
 *
 * Anonymous posts are excluded from the ranking. If they were counted, a member who only ever writes confessions
 * could be surfaced here on the strength of posts nobody is supposed to be able to attribute to them — a slow leak
 * through a "suggested for you" list is still a leak.
 */
export async function getSuggestedMembers(db: DbLike, storage: StorageProvider, actor: Actor, now: Date, hash: Uint8Array | null): Promise<SuggestedMemberDto[]> {
  const rows = await db.$queryRaw<{ authorId: string; posts: number }[]>(Prisma.sql`
    SELECT p."authorId", COUNT(*)::int AS posts
    FROM "CommunityPost" p
    JOIN "User" u ON u.id = p."authorId"
    WHERE ${postVisibleSql(actor.userId, hash)}
      AND p."createdAt" > ${new Date(now.getTime() - DISCOVER_RULES.suggestWindowMs)}
      AND p."isAnonymous" = FALSE
      AND p."authorId" <> ${actor.userId}
      AND u."accountType" = 'MEMBER'
      AND NOT EXISTS (SELECT 1 FROM "CommunityFollow" f WHERE f."followerId" = ${actor.userId} AND f."followingId" = p."authorId")
    GROUP BY p."authorId"
    ORDER BY posts DESC, p."authorId" ASC
    LIMIT ${DISCOVER_RULES.suggestMax}
  `);
  if (rows.length === 0) return [];
  const authors = await loadAuthors(db, storage, actor.userId, rows.map((r) => r.authorId));
  return rows.flatMap((r) => {
    const author = authors.get(r.authorId);
    return author ? [{ author, recentPosts: r.posts }] : [];
  });
}

/** Chips with something behind them this week, busiest first. A topic with no posts is simply absent. */
export async function getActiveTopics(db: DbLike, actor: Actor, now: Date, hash: Uint8Array | null): Promise<ActiveTopicDto[]> {
  const rows = await db.$queryRaw<{ topic: TopicKey; posts: number }[]>(Prisma.sql`
    SELECT p.topic::text AS topic, COUNT(*)::int AS posts
    FROM "CommunityPost" p
    JOIN "User" u ON u.id = p."authorId"
    WHERE ${postVisibleSql(actor.userId, hash)}
      AND p.topic IS NOT NULL
      AND p."createdAt" > ${new Date(now.getTime() - DISCOVER_RULES.activeTopicWindowMs)}
    GROUP BY p.topic
    ORDER BY posts DESC, p.topic ASC
  `);
  const labels = new Map(TOPICS.map((t) => [t.key, t.label]));
  return rows.flatMap((r) => {
    const label = labels.get(r.topic);
    return label ? [{ key: r.topic, label, posts: r.posts }] : [];
  });
}

/** All three modules in one call, for the feed route and the "not much here" state. */
export async function getCommunityDiscover(actor: Actor, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<CommunityDiscoverDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const hash = await viewerHash(db, actor.userId);
  const [popular, suggestions, activeTopics] = await Promise.all([
    getPopularToday(db, actor, now, hash),
    getSuggestedMembers(db, storage, actor, now, hash),
    getActiveTopics(db, actor, now, hash),
  ]);
  return { popular, suggestions, activeTopics };
}

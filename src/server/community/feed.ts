/**
 * Community feed and post reads (docs/ARCHITECTURE.md §14). One SQL visibility rule for posts:
 *   post not deleted · author ACTIVE and not deleted · no block / contact-block between viewer and author ·
 *   photo displayable under the community media policy (or the viewer is the author).
 * Keyset pagination on (createdAt DESC, id DESC) with an opaque cursor; "New" restricts to the last 24 hours.
 * Ranking is plain recency: no engagement machinery.
 */
import { Prisma } from "@/generated/prisma/client";
import { COMMUNITY } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { displayableCommunityMediaStates } from "@/lib/photo-policy";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { noBlockOrContactSql } from "@/server/discovery/predicate";
import { ANONYMOUS_AUTHOR, isMediaDisplayable, loadAuthors, photoDto, type CommunityPostDto } from "./dto";
import { loadPolls } from "./polls";
import { loadPostContext } from "./social-context";
import type { TopicKey } from "./topics";

/**
 * "Following" shows only posts by members the viewer has chosen to follow. It runs through exactly the same
 * visibility SQL as the other two tabs, so a follow row can never surface a post a block should have hidden.
 */
export type FeedTab = "FOR_YOU" | "FOLLOWING" | "NEW";

export interface FeedQuery {
  tab?: FeedTab;
  /** Chip filter. Null / undefined means "every topic", which is not the same as "no topic". */
  topic?: TopicKey | null;
  cursor?: string | null;
  limit?: number;
}

export interface FeedPage {
  posts: CommunityPostDto[];
  nextCursor: string | null;
  serverNow: string;
}

export interface CommunityDeps {
  db?: Db;
  storage?: StorageProvider;
  now?: Date;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
    const createdAt = new Date(iso ?? "");
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** The viewer's contact hash, needed by every predicate that has to respect contact blocking. */
export async function viewerHash(db: DbLike, viewerId: string): Promise<Uint8Array | null> {
  const viewer = await db.user.findUnique({ where: { id: viewerId }, select: { phoneHash: true } });
  if (!viewer) throw new NotFoundError("User");
  return viewer.phoneHash;
}

function mediaStatesSql(): Prisma.Sql {
  return Prisma.join(displayableCommunityMediaStates().map((m) => Prisma.sql`${m}::"PhotoModeration"`));
}

/** Aliases: p = CommunityPost, u = author User. */
export function postVisibleSql(viewerId: string, viewerPhoneHash: Uint8Array | null): Prisma.Sql {
  return Prisma.sql`
    p."deletedAt" IS NULL
    AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL
    AND ${noBlockOrContactSql(viewerId, viewerPhoneHash)}
    AND (p."photoKey" IS NULL OR p."photoModeration" IN (${mediaStatesSql()}) OR p."authorId" = ${viewerId})
  `;
}

/** Ids of visible posts for the viewer, newest first, bounded. */
export async function getFeedPostIds(db: DbLike, actor: Actor, options: FeedQuery & { now?: Date } = {}): Promise<{ ids: string[]; nextCursor: string | null }> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? COMMUNITY.feedPageSize, 1), 50);
  const hash = await viewerHash(db, actor.userId);
  const cursor = decodeCursor(options.cursor);
  const parts: Prisma.Sql[] = [postVisibleSql(actor.userId, hash)];
  if (options.tab === "NEW") parts.push(Prisma.sql`p."createdAt" > ${new Date(now.getTime() - COMMUNITY.newWindowMs)}`);
  if (options.tab === "FOLLOWING") {
    parts.push(Prisma.sql`p."authorId" IN (SELECT f."followingId" FROM "CommunityFollow" f WHERE f."followerId" = ${actor.userId})`);
  }
  if (options.topic) parts.push(Prisma.sql`p."topic" = ${options.topic}::"PostTopic"`);
  if (cursor) parts.push(Prisma.sql`(p."createdAt", p.id) < (${cursor.createdAt}, ${cursor.id})`);
  const rows = await db.$queryRaw<{ id: string; createdAt: Date }[]>(Prisma.sql`
    SELECT p.id, p."createdAt"
    FROM "CommunityPost" p
    JOIN "User" u ON u.id = p."authorId"
    WHERE ${Prisma.join(parts, " AND ")}
    ORDER BY p."createdAt" DESC, p.id DESC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { ids: page.map((r) => r.id), nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
}

/** May the viewer see this post right now? (Same rule as the feed.) */
export async function canSeePost(db: DbLike, actor: Actor, postId: string): Promise<boolean> {
  const hash = await viewerHash(db, actor.userId);
  const rows = await db.$queryRaw<{ ok: number }[]>(Prisma.sql`
    SELECT 1 AS ok FROM "CommunityPost" p JOIN "User" u ON u.id = p."authorId"
    WHERE p.id = ${postId} AND ${postVisibleSql(actor.userId, hash)} LIMIT 1
  `);
  return rows.length > 0;
}

/**
 * Hydrates post DTOs for ids that already passed the visibility rule, in the given order. A fixed number of
 * queries whatever the page size: posts, the viewer's likes, poll options and the viewer's votes, the social
 * context counts, then the authors.
 *
 * Anonymity is applied HERE, at the one place every Community read goes through — the feed, a single post, the
 * thread view and the DTO a fresh post returns all come out of this function — so there is no second code path
 * that could forget it. An anonymous post's author is replaced wholesale by ANONYMOUS_AUTHOR, never patched field
 * by field, and the author row is still loaded first because it is what enforces "no staff account is ever
 * rendered as a member" (§22.6). The database row keeps its authorId either way.
 */
export async function buildPostDtos(db: DbLike, storage: StorageProvider, actor: Actor, ids: string[]): Promise<CommunityPostDto[]> {
  if (ids.length === 0) return [];
  const [rows, liked] = await Promise.all([
    db.communityPost.findMany({
      where: { id: { in: ids } },
      select: { id: true, authorId: true, kind: true, topic: true, isAnonymous: true, body: true, photoKey: true, photoBlurhash: true, photoModeration: true, likeCount: true, commentCount: true, createdAt: true },
    }),
    db.communityLike.findMany({ where: { postId: { in: ids }, userId: actor.userId }, select: { postId: true } }),
  ]);
  const pollIds = rows.filter((r) => r.kind === "POLL").map((r) => r.id);
  const [authors, polls, context] = await Promise.all([
    loadAuthors(db, storage, actor.userId, rows.map((r) => r.authorId)),
    loadPolls(db, actor.userId, pollIds),
    loadPostContext(db, rows.map((r) => r.id)),
  ]);
  const likedSet = new Set(liked.map((l) => l.postId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: CommunityPostDto[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    const author = r ? authors.get(r.authorId) : undefined;
    if (!r || !author) continue;
    const mine = r.authorId === actor.userId;
    const displayable = !r.photoKey || isMediaDisplayable(r.photoModeration);
    out.push({
      id: r.id,
      kind: r.kind,
      topic: r.topic,
      body: r.body,
      photo: r.photoKey && displayable ? await photoDto(storage, r.photoKey, r.photoBlurhash) : null,
      photoUnderReview: Boolean(r.photoKey) && !displayable && mine,
      poll: polls.get(r.id) ?? null,
      likeCount: r.likeCount,
      commentCount: r.commentCount,
      likedByMe: likedSet.has(r.id),
      createdAt: r.createdAt.toISOString(),
      isAnonymous: r.isAnonymous,
      author: r.isAnonymous ? ANONYMOUS_AUTHOR : author,
      isMine: mine,
      context: context.get(r.id) ?? null,
    });
  }
  return out;
}

export async function getFeed(actor: Actor, options: FeedQuery = {}, deps: CommunityDeps = {}): Promise<FeedPage> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const { ids, nextCursor } = await getFeedPostIds(db, actor, { ...options, now });
  return { posts: await buildPostDtos(db, storage, actor, ids), nextCursor, serverNow: now.toISOString() };
}

/** One post, or NotFound when it does not exist or is not visible to the viewer (never confirms existence). */
export async function getPost(actor: Actor, postId: string, deps: CommunityDeps = {}): Promise<CommunityPostDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  if (!(await canSeePost(db, actor, postId))) throw new NotFoundError("Post");
  const [post] = await buildPostDtos(db, storage, actor, [postId]);
  if (!post) throw new NotFoundError("Post");
  return post;
}

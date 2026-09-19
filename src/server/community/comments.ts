/**
 * Flat comments on a post (the prototype shows counts only; the thread view is the smallest addition that makes them
 * real). Visibility mirrors the feed: deleted, blocked and non-active authors are excluded in SQL. Oldest first,
 * bounded pages with an opaque cursor.
 */
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { COMMUNITY } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { noBlockOrContactSql } from "@/server/discovery/predicate";
import { loadAuthors, type CommunityCommentDto } from "./dto";
import { canSeePost } from "./feed";
import { notifyCommunity } from "./notify";
import { assertMemberAccount } from "@/server/members/guard";

export const commentBodySchema = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, "\n").replace(/\p{Cc}/gu, (c) => (c === "\n" ? c : "")).trim())
  .pipe(z.string().min(1, "Write something first").max(COMMUNITY.commentMaxLength, `Comments can be up to ${COMMUNITY.commentMaxLength} characters`));

export interface CommentsPage {
  comments: CommunityCommentDto[];
  nextCursor: string | null;
}

const encode = (createdAt: Date, id: string) => Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
function decode(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
    const createdAt = new Date(iso ?? "");
    return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

export async function listComments(actor: Actor, postId: string, options: { cursor?: string | null; limit?: number } = {}, deps: { db?: Db; storage?: StorageProvider } = {}): Promise<CommentsPage> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const limit = Math.min(Math.max(options.limit ?? COMMUNITY.commentsPageSize, 1), 100);
  if (!(await canSeePost(db, actor, postId))) throw new NotFoundError("Post");
  const viewer = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { phoneHash: true } });
  const cursor = decode(options.cursor);
  const rows = await db.$queryRaw<{ id: string; authorId: string; body: string; createdAt: Date }[]>(Prisma.sql`
    SELECT c.id, c."authorId", c.body, c."createdAt"
    FROM "CommunityComment" c
    JOIN "User" u ON u.id = c."authorId"
    WHERE c."postId" = ${postId} AND c."deletedAt" IS NULL
      AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL
      AND ${noBlockOrContactSql(actor.userId, viewer.phoneHash)}
      ${cursor ? Prisma.sql`AND (c."createdAt", c.id) > (${cursor.createdAt}, ${cursor.id})` : Prisma.empty}
    ORDER BY c."createdAt" ASC, c.id ASC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const authors = await loadAuthors(db, storage, actor.userId, page.map((r) => r.authorId));
  const comments = page.flatMap((r) => {
    const author = authors.get(r.authorId);
    return author ? [{ id: r.id, body: r.body, createdAt: r.createdAt.toISOString(), author, isMine: r.authorId === actor.userId }] : [];
  });
  const last = page[page.length - 1];
  return { comments, nextCursor: hasMore && last ? encode(last.createdAt, last.id) : null };
}

export async function addComment(actor: Actor, postId: string, rawBody: string, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<CommunityCommentDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  await assertMemberAccount(db, actor.userId);
  const parsed = commentBodySchema.safeParse(rawBody ?? "");
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "That comment isn't valid");
  if (!(await canSeePost(db, actor, postId))) throw new NotFoundError("Post");
  const limit = await consumeRateLimit(db, `community:comment:${actor.userId}`, COMMUNITY.commentsPerMinute, 60_000, now);
  if (!limit.allowed) throw new ValidationError("You're commenting very quickly. Take a breath and try again.");

  const comment = await db.$transaction(async (tx) => {
    const created = await tx.communityComment.create({ data: { postId, authorId: actor.userId, body: parsed.data, createdAt: now }, select: { id: true, createdAt: true } });
    await tx.$executeRaw`UPDATE "CommunityPost" SET "commentCount" = "commentCount" + 1 WHERE id = ${postId}`;
    const post = await tx.communityPost.findUniqueOrThrow({ where: { id: postId }, select: { authorId: true } });
    await notifyCommunity(tx, { type: "COMMUNITY_COMMENT", recipientId: post.authorId, actorId: actor.userId, postId, now });
    return created;
  });
  const authors = await loadAuthors(db, storage, actor.userId, [actor.userId]);
  return { id: comment.id, body: parsed.data, createdAt: comment.createdAt.toISOString(), author: authors.get(actor.userId)!, isMine: true };
}

/** Soft delete by the comment's author only. */
export async function deleteComment(actor: Actor, commentId: string, options: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const result = await tx.communityComment.updateMany({ where: { id: commentId, authorId: actor.userId, deletedAt: null }, data: { deletedAt: now } });
    if (result.count === 0) throw new NotFoundError("Comment");
    const c = await tx.communityComment.findUniqueOrThrow({ where: { id: commentId }, select: { postId: true } });
    await tx.$executeRaw`UPDATE "CommunityPost" SET "commentCount" = GREATEST(0, "commentCount" - 1) WHERE id = ${c.postId}`;
  });
}

export async function countVisibleComments(db: DbLike, postId: string): Promise<number> {
  return db.communityComment.count({ where: { postId, deletedAt: null } });
}

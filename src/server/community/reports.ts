/**
 * Community safety (docs/ARCHITECTURE.md §14): report a post or a comment with an evidence snapshot, and block an
 * author. Unlike the conversation flow, a Community report does NOT block automatically — Report and Block are
 * separate actions, as in the prototype's menu. Targets are resolved server-side from the post/comment id.
 */
import { z } from "zod";
import { getDb, type Db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { blockUser } from "@/server/safety/block";
import { REPORT_REASONS } from "@/server/safety/report";
import { canSeePost } from "./feed";

const base = { reason: z.enum(REPORT_REASONS), note: z.string().trim().max(500).regex(/^[^<>]*$/, "Notes can't contain < or >").optional().or(z.literal("")) };
export const reportPostSchema = z.object({ postId: z.string().min(1).max(64), ...base });
export const reportCommentSchema = z.object({ commentId: z.string().min(1).max(64), ...base });

export async function reportPost(actor: Actor, input: unknown, options: { db?: Db; now?: Date } = {}): Promise<{ reportId: string }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const parsed = reportPostSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "That report isn't valid");
  const { postId, reason, note } = parsed.data;
  if (!(await canSeePost(db, actor, postId))) throw new NotFoundError("Post");
  const post = await db.communityPost.findUniqueOrThrow({ where: { id: postId }, select: { authorId: true, kind: true, body: true, photoKey: true, createdAt: true } });
  if (post.authorId === actor.userId) throw new ValidationError("You can't report your own post");
  const report = await db.report.create({
    data: {
      reporterId: actor.userId,
      targetUserId: post.authorId,
      targetPostId: postId,
      reason,
      note: note ? note : null,
      snapshot: { kind: post.kind, body: post.body, photoKey: post.photoKey, postedAt: post.createdAt.toISOString() },
      createdAt: now,
    },
    select: { id: true },
  });
  return { reportId: report.id };
}

export async function reportComment(actor: Actor, input: unknown, options: { db?: Db; now?: Date } = {}): Promise<{ reportId: string }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const parsed = reportCommentSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "That report isn't valid");
  const { commentId, reason, note } = parsed.data;
  const comment = await db.communityComment.findUnique({ where: { id: commentId }, select: { postId: true, authorId: true, body: true, createdAt: true, deletedAt: true } });
  if (!comment || comment.deletedAt || !(await canSeePost(db, actor, comment.postId))) throw new NotFoundError("Comment");
  if (comment.authorId === actor.userId) throw new ValidationError("You can't report your own comment");
  const report = await db.report.create({
    data: {
      reporterId: actor.userId,
      targetUserId: comment.authorId,
      targetCommentId: commentId,
      reason,
      note: note ? note : null,
      snapshot: { postId: comment.postId, body: comment.body, commentedAt: comment.createdAt.toISOString() },
      createdAt: now,
    },
    select: { id: true },
  });
  return { reportId: report.id };
}

/** Blocks the author of a post; the author is resolved from the post on the server. */
export async function blockPostAuthor(actor: Actor, postId: string, options: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = options.db ?? getDb();
  const post = await db.communityPost.findUnique({ where: { id: postId }, select: { authorId: true } });
  if (!post || post.authorId === actor.userId) throw new NotFoundError("Post");
  await blockUser(actor, post.authorId, { db, now: options.now });
}

export async function blockCommentAuthor(actor: Actor, commentId: string, options: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = options.db ?? getDb();
  const comment = await db.communityComment.findUnique({ where: { id: commentId }, select: { authorId: true } });
  if (!comment || comment.authorId === actor.userId) throw new NotFoundError("Comment");
  await blockUser(actor, comment.authorId, { db, now: options.now });
}

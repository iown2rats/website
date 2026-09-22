/**
 * Reactions on Community posts and comments (docs/ARCHITECTURE.md §14.10).
 *
 * THE POST TABLE IS THE OLD LIKE TABLE, and that is the design rather than an accident of history. The prototype's
 * post card had one heart; the brief asked for six reactions with the same layout and the same interaction
 * hierarchy. Bolting a second, parallel reaction system beside the heart would have put TWO ❤️ on every post —
 * one that counts towards `likeCount`, Popular Today and the COMMUNITY_LIKE notification, and one that does not —
 * so instead the heart BECAME the reaction control: `CommunityLike` gained an `emoji` column defaulting to HEART,
 * every row already in it was already a ❤️ from that member on that post, and nothing had to be rewritten.
 *
 * What that buys, all of it for free: one active reaction per member per post was ALREADY the primary key, so the
 * "one per user" rule needs no new enforcement; `likeCount` was already the count of those rows, so it is now the
 * total reaction count and every feature reading it keeps working; and there is still exactly ONE notification
 * producer for reacting to a post, so no second path exists that could report the same reaction twice.
 *
 * Comments get their own table with the same shape. Three small strongly-keyed tables rather than one polymorphic
 * `reactions` table with three nullable target columns: a real foreign key per target means the database itself
 * refuses a reaction to something that does not exist, cascades need no application code, and no read has to work
 * out which column is set before it can authorise anything.
 *
 * Idempotency everywhere: the counter moves only when a row was genuinely inserted or genuinely deleted, decided
 * by what Postgres reports about the statement rather than by a read-then-write that two taps could interleave.
 */
import { Prisma } from "@/generated/prisma/client";
import { COMMUNITY } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { EMPTY_REACTIONS, isReactionKey, type ReactionKey, type ReactionSummaryDto } from "@/lib/reactions";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { noBlockOrContactSql } from "@/server/discovery/predicate";
import { assertMemberAccount } from "@/server/members/guard";
import { notifyReaction } from "@/server/notifications/reactions";
import { loadAuthors, loadCommentReactions, loadPostReactions, type CommunityAuthorDto } from "./dto";
import { canSeePost } from "./feed";
import { notifyCommunity } from "./notify";

export interface PostReactionResult {
  /** Total reactions on the post — the number beside the control, and still `CommunityPost.likeCount`. */
  likeCount: number;
  reactions: ReactionSummaryDto;
}

/**
 * Sets, replaces or clears the actor's reaction to a post.
 *
 * DECLARATIVE, not a toggle: `emoji` is the state the actor wants to end up in, null meaning none. Sending 😂
 * twice leaves one 😂. That is what makes a retried request harmless, and it is why the client — which knows its
 * own current reaction — is the thing that turns "tap the one I already have" into null.
 */
export async function setPostReaction(actor: Actor, postId: string, emoji: ReactionKey | null, options: { db?: Db; now?: Date } = {}): Promise<PostReactionResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (emoji !== null && !isReactionKey(emoji)) throw new ValidationError("That isn't a reaction");
  await assertMemberAccount(db, actor.userId);
  if (!(await canSeePost(db, actor, postId))) throw new NotFoundError("Post");
  const limit = await consumeRateLimit(db, `community:react:${actor.userId}`, COMMUNITY.reactionsPerMinute, 60_000, now);
  if (!limit.allowed) throw new ValidationError("Slow down a little.");

  return db.$transaction(async (tx) => {
    const next = emoji;

    if (next === null) {
      // The DELETE's own row count decides the decrement, so two concurrent removals cannot both subtract one.
      const removed = await tx.$executeRaw`DELETE FROM "CommunityLike" WHERE "postId" = ${postId} AND "userId" = ${actor.userId}`;
      if (removed > 0) await tx.$executeRaw`UPDATE "CommunityPost" SET "likeCount" = GREATEST(0, "likeCount" - 1) WHERE id = ${postId}`;
    } else {
      /*
       * One statement does add-or-replace. `xmax = 0` is Postgres's own answer to "did this INSERT ... ON CONFLICT
       * actually insert?" — a freshly inserted tuple has no updating transaction, an updated one carries ours —
       * which is what keeps `likeCount` exact: swapping ❤️ for 😂 must not increment anything, and a double-tapped
       * add must not increment twice.
       */
      const rows = await tx.$queryRaw<{ inserted: boolean }[]>`
        INSERT INTO "CommunityLike" ("postId", "userId", emoji, "createdAt")
        VALUES (${postId}, ${actor.userId}, ${next}::"ReactionEmoji", ${now})
        ON CONFLICT ("postId", "userId") DO UPDATE SET emoji = EXCLUDED.emoji
        RETURNING (xmax = 0) AS inserted
      `;
      if (rows[0]?.inserted) await tx.$executeRaw`UPDATE "CommunityPost" SET "likeCount" = "likeCount" + 1 WHERE id = ${postId}`;
    }

    const post = await tx.communityPost.findUniqueOrThrow({ where: { id: postId }, select: { likeCount: true, authorId: true } });
    // The existing COMMUNITY_LIKE producer, now carrying the emoji. Removing a reaction tells nobody; changing one
    // rewrites the row already waiting rather than adding a second.
    if (next !== null) await notifyCommunity(tx, { type: "COMMUNITY_LIKE", recipientId: post.authorId, actorId: actor.userId, postId, emoji: next, now });

    const reactions = await loadPostReactions(tx, actor.userId, [postId]);
    return { likeCount: post.likeCount, reactions: reactions.get(postId) ?? EMPTY_REACTIONS };
  });
}

/**
 * The prototype's one-tap heart, expressed in terms of the reaction system: the post card's plain tap either adds
 * a ❤️ or clears whatever reaction you had. Kept as its own function because it is a distinct product gesture
 * from "choose an emoji from the picker", and because every existing caller and regression test speaks it.
 */
export async function setReaction(actor: Actor, postId: string, liked: boolean, options: { db?: Db; now?: Date } = {}): Promise<PostReactionResult & { liked: boolean }> {
  const result = await setPostReaction(actor, postId, liked ? "HEART" : null, options);
  return { ...result, liked: result.reactions.mine !== null };
}

export interface CommentReactionResult {
  commentId: string;
  reactions: ReactionSummaryDto;
}

/** Sets, replaces or clears the actor's reaction to a comment. Same gesture rules as posts. */
export async function setCommentReaction(actor: Actor, commentId: string, emoji: ReactionKey | null, options: { db?: Db; now?: Date } = {}): Promise<CommentReactionResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (emoji !== null && !isReactionKey(emoji)) throw new ValidationError("That isn't a reaction");
  await assertMemberAccount(db, actor.userId);

  // Visibility is the POST's rule, re-derived from the comment. A comment id belonging to a post this member may
  // not see is refused exactly as an unknown id is, so nothing can be probed.
  const comment = await db.communityComment.findUnique({ where: { id: commentId }, select: { id: true, postId: true, authorId: true, deletedAt: true } });
  if (!comment || comment.deletedAt !== null) throw new NotFoundError("Comment");
  if (!(await canSeePost(db, actor, comment.postId))) throw new NotFoundError("Comment");

  const limit = await consumeRateLimit(db, `community:react:${actor.userId}`, COMMUNITY.reactionsPerMinute, 60_000, now);
  if (!limit.allowed) throw new ValidationError("Slow down a little.");

  return db.$transaction(async (tx) => {
    // Re-checked inside the transaction: a comment deleted between the read above and this write must not gain one.
    const live = await tx.communityComment.findFirst({ where: { id: commentId, deletedAt: null }, select: { id: true } });
    if (!live) throw new NotFoundError("Comment");

    const next = emoji;

    if (next === null) {
      await tx.communityCommentReaction.deleteMany({ where: { commentId, userId: actor.userId } });
    } else {
      await tx.$executeRaw`
        INSERT INTO "CommunityCommentReaction" ("commentId", "userId", emoji, "createdAt", "updatedAt")
        VALUES (${commentId}, ${actor.userId}, ${next}::"ReactionEmoji", ${now}, ${now})
        ON CONFLICT ("commentId", "userId") DO UPDATE SET emoji = EXCLUDED.emoji, "updatedAt" = EXCLUDED."updatedAt"
      `;
      await notifyReaction(tx, {
        type: "COMMUNITY_COMMENT_REACTION",
        recipientId: comment.authorId,
        actorId: actor.userId,
        emoji: next,
        // The comment's post, so the notification can link to the thread the comment lives in.
        postId: comment.postId,
        targetId: commentId,
        now,
      });
    }

    const reactions = await loadCommentReactions(tx, actor.userId, [commentId]);
    return { commentId, reactions: reactions.get(commentId) ?? EMPTY_REACTIONS };
  });
}

export interface CommunityReactorDto {
  emoji: ReactionKey;
  author: CommunityAuthorDto;
  isMe: boolean;
}

/**
 * Who reacted to a post, and with what.
 *
 * Bounded, and filtered in SQL by the same predicate the feed and the comment list use: a member on either side of
 * a block with the viewer is not named, nor is a suspended or deleted account, nor is a STAFF account (which is
 * never rendered as a member anywhere). `loadAuthors` then decides what may be shown about each one — display
 * name, island or not, a displayable photo or none — so this list cannot reveal more about somebody than the rest
 * of Community already does.
 */
export async function listPostReactors(actor: Actor, postId: string, deps: { db?: Db; storage?: StorageProvider } = {}): Promise<CommunityReactorDto[]> {
  const db = deps.db ?? getDb();
  if (!(await canSeePost(db, actor, postId))) throw new NotFoundError("Post");
  return reactorsFrom(db, deps.storage ?? getStorageProvider(), actor, Prisma.sql`
    SELECT r."userId", r.emoji::text AS emoji
    FROM "CommunityLike" r JOIN "User" u ON u.id = r."userId"
    WHERE r."postId" = ${postId} AND ${noBlockOrContactSql(actor.userId, null)}
      AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL
    ORDER BY r."createdAt" ASC
    LIMIT ${COMMUNITY.reactorsPageSize}
  `);
}

/** Who reacted to a comment, and with what. Same rules as `listPostReactors`. */
export async function listCommentReactors(actor: Actor, commentId: string, deps: { db?: Db; storage?: StorageProvider } = {}): Promise<CommunityReactorDto[]> {
  const db = deps.db ?? getDb();
  const comment = await db.communityComment.findUnique({ where: { id: commentId }, select: { postId: true, deletedAt: true } });
  if (!comment || comment.deletedAt !== null) throw new NotFoundError("Comment");
  if (!(await canSeePost(db, actor, comment.postId))) throw new NotFoundError("Comment");
  return reactorsFrom(db, deps.storage ?? getStorageProvider(), actor, Prisma.sql`
    SELECT r."userId", r.emoji::text AS emoji
    FROM "CommunityCommentReaction" r JOIN "User" u ON u.id = r."userId"
    WHERE r."commentId" = ${commentId} AND ${noBlockOrContactSql(actor.userId, null)}
      AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL
    ORDER BY r."createdAt" ASC
    LIMIT ${COMMUNITY.reactorsPageSize}
  `);
}

async function reactorsFrom(db: Db, storage: StorageProvider, actor: Actor, query: Prisma.Sql): Promise<CommunityReactorDto[]> {
  const rows = await db.$queryRaw<{ userId: string; emoji: string }[]>(query);
  const authors = await loadAuthors(db, storage, actor.userId, rows.map((r) => r.userId));
  // An author `loadAuthors` declined to return (a staff account, a row it would not render) is dropped rather than
  // rendered as an anonymous stub: the reaction still counts in the summary, it simply has no name to show.
  return rows.flatMap((row) => {
    const author = authors.get(row.userId);
    return author && isReactionKey(row.emoji) ? [{ emoji: row.emoji, author, isMe: row.userId === actor.userId }] : [];
  });
}

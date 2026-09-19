/**
 * The single heart reaction (prototype). Idempotent: rapid repeated clicks cannot create duplicate rows or drift the
 * count, because the insert/delete is keyed on (postId, userId) and the counter moves only when a row actually changed.
 * Reactions never touch the dating like allowance, likes, matches or conversations.
 */
import { COMMUNITY } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { notifyCommunity } from "./notify";
import { canSeePost } from "./feed";
import { assertMemberAccount } from "@/server/members/guard";

export interface ReactionResult {
  liked: boolean;
  likeCount: number;
}

export async function setReaction(actor: Actor, postId: string, liked: boolean, options: { db?: Db; now?: Date } = {}): Promise<ReactionResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  await assertMemberAccount(db, actor.userId);
  if (!(await canSeePost(db, actor, postId))) throw new NotFoundError("Post");
  const limit = await consumeRateLimit(db, `community:react:${actor.userId}`, COMMUNITY.reactionsPerMinute, 60_000, now);
  if (!limit.allowed) throw new ValidationError("Slow down a little.");

  return db.$transaction(async (tx) => {
    let changed = 0;
    if (liked) {
      changed = await tx.$executeRaw`
        INSERT INTO "CommunityLike" ("postId", "userId", "createdAt") VALUES (${postId}, ${actor.userId}, ${now})
        ON CONFLICT ("postId", "userId") DO NOTHING
      `;
      if (changed > 0) await tx.$executeRaw`UPDATE "CommunityPost" SET "likeCount" = "likeCount" + 1 WHERE id = ${postId}`;
    } else {
      changed = await tx.$executeRaw`DELETE FROM "CommunityLike" WHERE "postId" = ${postId} AND "userId" = ${actor.userId}`;
      if (changed > 0) await tx.$executeRaw`UPDATE "CommunityPost" SET "likeCount" = GREATEST(0, "likeCount" - 1) WHERE id = ${postId}`;
    }
    const post = await tx.communityPost.findUniqueOrThrow({ where: { id: postId }, select: { likeCount: true, authorId: true } });
    if (liked && changed > 0) await notifyCommunity(tx, { type: "COMMUNITY_LIKE", recipientId: post.authorId, actorId: actor.userId, postId, now });
    return { liked, likeCount: post.likeCount };
  });
}

/**
 * Community notifications: reactions and comments on your post. Never to yourself, never across a block, honouring
 * the recipient's Community notification setting (off by default, as in the prototype), one unread per
 * (type, post, actor).
 *
 * COMMUNITY_LIKE is the POST REACTION notification. It was the heart-only notification and it still is the same
 * producer, because the heart on a post card became the reaction control rather than gaining a rival next to it:
 * one act, one row, nothing that can report the same reaction twice. `emoji` rides along in `data` so the feed can
 * say "reacted 😂 to your post" instead of "liked your post", and an existing unread row is rewritten rather than
 * duplicated when somebody changes their mind — `createdAt` stays put so the row does not jump the feed on a tap.
 *
 * Rows written before reactions existed carry no `emoji` and read as the heart they were.
 */
import type { Tx } from "@/lib/db";
import type { ReactionKey } from "@/lib/reactions";
import { isBlockedEitherWay } from "@/server/safety/block";

export async function notifyCommunity(
  tx: Tx,
  input: { type: "COMMUNITY_LIKE" | "COMMUNITY_COMMENT"; recipientId: string; actorId: string; postId: string; emoji?: ReactionKey; now: Date },
): Promise<void> {
  if (input.recipientId === input.actorId) return;
  if (await isBlockedEitherWay(tx, input.recipientId, input.actorId)) return;
  const settings = await tx.notificationSettings.findUnique({ where: { userId: input.recipientId }, select: { community: true } });
  if (!settings?.community) return;
  const existing = await tx.notification.findFirst({ where: { userId: input.recipientId, type: input.type, postId: input.postId, actorId: input.actorId, readAt: null }, select: { id: true } });
  if (existing) {
    // A reaction can change while its notification is still unread; a comment cannot, so only the first case writes.
    if (input.emoji) await tx.notification.update({ where: { id: existing.id }, data: { data: { emoji: input.emoji } } });
    return;
  }
  await tx.notification.create({
    data: {
      userId: input.recipientId,
      type: input.type,
      actorId: input.actorId,
      postId: input.postId,
      ...(input.emoji ? { data: { emoji: input.emoji } } : {}),
      createdAt: input.now,
    },
  });
}

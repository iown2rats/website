/**
 * Community notifications: reactions and comments on your post. Never to yourself, never across a block, honouring
 * the recipient's Community notification setting (off by default, as in the prototype), one unread per (type, post, actor).
 */
import type { Tx } from "@/lib/db";
import { isBlockedEitherWay } from "@/server/safety/block";

export async function notifyCommunity(tx: Tx, input: { type: "COMMUNITY_LIKE" | "COMMUNITY_COMMENT"; recipientId: string; actorId: string; postId: string; now: Date }): Promise<void> {
  if (input.recipientId === input.actorId) return;
  if (await isBlockedEitherWay(tx, input.recipientId, input.actorId)) return;
  const settings = await tx.notificationSettings.findUnique({ where: { userId: input.recipientId }, select: { community: true } });
  if (!settings?.community) return;
  const existing = await tx.notification.findFirst({ where: { userId: input.recipientId, type: input.type, postId: input.postId, actorId: input.actorId, readAt: null }, select: { id: true } });
  if (existing) return;
  await tx.notification.create({ data: { userId: input.recipientId, type: input.type, actorId: input.actorId, postId: input.postId, createdAt: input.now } });
}

import { getDb, type Db } from "@/lib/db";
import type { Actor } from "@/server/actor";
import { countUnreadConversations } from "@/server/conversations/messages";

export interface NavBadgeCounts {
  likes: number;
  chats: number;
}

/** Unread counts for the bottom nav / sidebar. Likes = unread like/intro notifications; Chats = conversations with unread incoming messages, derived from persisted read state. */
export async function getNavBadges(actor: Actor, deps: { db?: Db } = {}): Promise<NavBadgeCounts> {
  const db = deps.db ?? getDb();
  const [likes, chats] = await Promise.all([
    db.notification.count({ where: { userId: actor.userId, readAt: null, type: { in: ["LIKE_RECEIVED", "INTRO_RECEIVED", "NEW_MATCH"] } } }),
    countUnreadConversations(db, actor.userId),
  ]);
  return { likes, chats };
}

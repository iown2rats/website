/**
 * The one way a conversation is loaded on behalf of a member.
 *
 * Its own file because everything that touches a conversation needs it — sending, editing, reacting, reading,
 * polling — and the alternative was an import cycle: reactions authorise through the conversation, while the
 * message DTOs hydrate through the reactions. One shared module instead of two files importing each other.
 */
import type { Db, DbLike } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { isBlockedEitherWay } from "@/server/safety/block";

/**
 * Throws NotFound (never Forbidden) when the actor is not a participant or the pair is blocked, so ids cannot be
 * probed: "not yours" and "does not exist" are the same answer. LOCKED conversations ARE returned — history stays
 * readable — and every write path checks the status separately.
 */
export async function getConversationForActor(db: DbLike, actor: Actor, conversationId: string) {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, participants: { some: { userId: actor.userId } } },
    select: { id: true, status: true, userAId: true, userBId: true, lastMessageAt: true, interactionAt: true, matchId: true },
  });
  if (!conversation) throw new NotFoundError("Conversation");
  const otherId = conversation.userAId === actor.userId ? conversation.userBId : conversation.userAId;
  if (await isBlockedEitherWay(db as Db, actor.userId, otherId)) throw new NotFoundError("Conversation");
  return { ...conversation, otherUserId: otherId };
}

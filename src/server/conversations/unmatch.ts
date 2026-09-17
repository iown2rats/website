/**
 * Unmatch (docs/ARCHITECTURE.md §10): ends the dating connection with soft state. The Match becomes UNMATCHED,
 * the Conversation LOCKED; messages are kept as moderation evidence. Runs under the pair lock so a concurrent
 * send cannot land after the unmatch commits. No notification is sent to the other person.
 */
import { getDb, type Db } from "@/lib/db";
import { InvalidStateError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { lockPair } from "@/server/locks";
import { getConversationForActor } from "./messages";

export async function unmatchConversation(actor: Actor, conversationId: string, options: { now?: Date; db?: Db } = {}): Promise<{ matchId: string | null }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const conversation = await getConversationForActor(db, actor, conversationId);
  return db.$transaction(async (tx) => {
    await lockPair(tx, actor.userId, conversation.otherUserId);
    const fresh = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { status: true, matchId: true } });
    if (fresh.status === "LOCKED") throw new InvalidStateError("This conversation has already ended");
    if (fresh.matchId) {
      await tx.match.updateMany({ where: { id: fresh.matchId, status: "ACTIVE" }, data: { status: "UNMATCHED", unmatchedAt: now, unmatchedById: actor.userId } });
    }
    await tx.conversation.update({ where: { id: conversationId }, data: { status: "LOCKED" } });
    // Pending "new message" / "new match" notifications about this conversation are no longer actionable.
    await tx.notification.updateMany({ where: { conversationId, type: { in: ["MESSAGE", "NEW_MATCH"] }, readAt: null }, data: { readAt: now } });
    return { matchId: fresh.matchId };
  });
}

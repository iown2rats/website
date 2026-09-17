import { notFound } from "next/navigation";
import { Conversation } from "@/components/features/chats/conversation";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";
import { getConversationHeader } from "@/server/conversations/list";
import { listMessages, toAvailabilityDto } from "@/server/conversations/messages";
import { getMessageAvailability } from "@/server/entitlements";

export const dynamic = "force-dynamic";

/**
 * One conversation. Authorised as a participant (NotFound otherwise, never Forbidden); the newest page of history
 * and the sender's current availability are loaded here, the rest streams through polling and older-page loads.
 */
export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const actor = await requireActiveUser();
  const { conversationId } = await params;
  const db = getDb();
  const now = new Date();
  const header = await getConversationHeader(actor, conversationId, { db, now }).catch(() => null);
  if (!header) notFound();
  const [page, availability] = await Promise.all([listMessages(actor, conversationId, { db, now }), getMessageAvailability(db, actor.userId, now)]);
  return <Conversation key={conversationId} header={header} initialPage={page} initialAvailability={toAvailabilityDto(availability)} serverNow={now.toISOString()} />;
}

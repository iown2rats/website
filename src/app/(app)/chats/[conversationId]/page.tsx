import { notFound } from "next/navigation";
import { Conversation } from "@/components/features/chats/conversation";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";
import { getConversationHeader } from "@/server/conversations/list";
import { listMessages } from "@/server/conversations/messages";

export const dynamic = "force-dynamic";

/**
 * One conversation. Authorised as a participant (NotFound otherwise, never Forbidden); the newest page of history
 * is loaded here, the rest streams through polling and older-page loads.
 */
export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const actor = await requireActiveUser();
  const { conversationId } = await params;
  const db = getDb();
  const now = new Date();
  const header = await getConversationHeader(actor, conversationId, { db, now }).catch(() => null);
  if (!header) notFound();
  const page = await listMessages(actor, conversationId, { db, now });
  return <Conversation key={conversationId} header={header} initialPage={page} serverNow={now.toISOString()} />;
}

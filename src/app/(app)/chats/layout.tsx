import type { ReactNode } from "react";
import { ChatsList } from "@/components/features/chats/chats-list";
import { ChatsSplit } from "@/components/features/chats/chats-split";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";
import { listConversations } from "@/server/conversations/list";

// Private, personalised data: rendered per request for the signed-in user only.
export const dynamic = "force-dynamic";

export default async function ChatsLayout({ children }: { children: ReactNode }) {
  const actor = await requireActiveUser();
  const db = getDb();
  const [list, everMatched] = await Promise.all([
    listConversations(actor),
    db.match.count({ where: { OR: [{ userAId: actor.userId }, { userBId: actor.userId }] } }),
  ]);
  return (
    <ChatsSplit list={<ChatsList initial={list} hasEverMatched={everMatched > 0} />}>
      {children}
    </ChatsSplit>
  );
}

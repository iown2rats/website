import { notFound } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { ChatIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { PageFrame } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/screen-header";
import { DISCOVERY } from "@/config/product";
import { getDb } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS } from "@/lib/storage/provider";
import { requireActiveUser } from "@/server/auth/current-user";
import { getConversationForActor } from "@/server/conversations/messages";
import { isDemoKey } from "@/server/discovery/dto";

export const dynamic = "force-dynamic";

/**
 * Conversation shell (Phase 6 §16): the destination of "Say hello" on the match screen. Authorised through the
 * same participant check messaging will use; the message list and composer arrive in Phase 8.
 */
export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const actor = await requireActiveUser();
  const { conversationId } = await params;
  const db = getDb();
  const conversation = await getConversationForActor(db, actor, conversationId).catch(() => null);
  if (!conversation) notFound();
  const other = await db.profile.findUnique({
    where: { userId: conversation.otherUserId },
    select: { displayName: true, photos: { where: { moderation: { in: [...DISCOVERY.displayableModeration] } }, orderBy: { position: "asc" }, take: 1, select: { thumbKey: true, blurhash: true } } },
  });
  const first = other?.photos[0];
  const photo = first ? (isDemoKey(first.thumbKey) ? { key: first.thumbKey, blurhash: first.blurhash } : { url: await getStorageProvider().getReadUrl(first.thumbKey, PHOTO_URL_TTL_SECONDS), blurhash: first.blurhash }) : null;
  const name = other?.displayName ?? "Your match";
  return (
    <PageFrame>
      <PageHeader
        backHref="/chats"
        title={
          <span className="flex items-center gap-2.5">
            <Avatar name={name} photo={photo} size={32} />
            {name}
          </span>
        }
      />
      <EmptyState
        icon={<ChatIcon />}
        title={`You matched with ${name}.`}
        description="Messaging opens in the next update. Your match is saved and will be here when it does."
        className="flex-1"
      />
    </PageFrame>
  );
}

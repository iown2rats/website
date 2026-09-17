/**
 * Desktop Discover side panel: the viewer's newest matches and recent activity, from real rows.
 * Photos are the other person's primary thumb through the storage provider; nothing private leaves.
 */
import { DISCOVERY } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { isDemoKey } from "@/server/discovery/dto";

export interface AsidePhoto {
  url: string | null;
  demoKey: string | null;
  blurhash: string;
}
export interface AsideMatchDto {
  name: string;
  conversationId: string | null;
  photo: AsidePhoto | null;
}
export interface AsideActivityDto {
  name: string;
  text: string;
  at: string;
  photo: AsidePhoto | null;
}

async function primaryPhoto(db: Db, userId: string, storage: StorageProvider): Promise<AsidePhoto | null> {
  const ph = await db.profilePhoto.findFirst({
    where: { profile: { userId }, moderation: { in: [...DISCOVERY.displayableModeration] } },
    orderBy: { position: "asc" },
    select: { thumbKey: true, blurhash: true },
  });
  if (!ph) return null;
  if (isDemoKey(ph.thumbKey)) return { url: null, demoKey: ph.thumbKey, blurhash: ph.blurhash };
  return { url: await storage.getReadUrl(ph.thumbKey, PHOTO_URL_TTL_SECONDS), demoKey: null, blurhash: ph.blurhash };
}

export async function getDiscoverAside(actor: Actor, deps: { db?: Db; storage?: StorageProvider } = {}): Promise<{ matches: AsideMatchDto[]; activity: AsideActivityDto[] }> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const [matches, notifications] = await Promise.all([
    db.match.findMany({
      where: { status: "ACTIVE", OR: [{ userAId: actor.userId }, { userBId: actor.userId }] },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { userAId: true, userBId: true, conversation: { select: { id: true } }, userA: { select: { profile: { select: { displayName: true } } } }, userB: { select: { profile: { select: { displayName: true } } } } },
    }),
    db.notification.findMany({
      where: { userId: actor.userId, type: { in: ["LIKE_RECEIVED", "NEW_MATCH", "MESSAGE"] }, actorId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { type: true, createdAt: true, actorId: true, actor: { select: { profile: { select: { displayName: true } } } } },
    }),
  ]);
  const matchDtos = await Promise.all(
    matches.map(async (m) => {
      const otherId = m.userAId === actor.userId ? m.userBId : m.userAId;
      const other = m.userAId === actor.userId ? m.userB : m.userA;
      return { name: other.profile?.displayName ?? "Match", conversationId: m.conversation?.id ?? null, photo: await primaryPhoto(db, otherId, storage) };
    }),
  );
  const text = { LIKE_RECEIVED: "liked you", NEW_MATCH: "matched with you", MESSAGE: "sent a message" } as const;
  const activity = await Promise.all(
    notifications.map(async (n) => ({
      name: n.actor?.profile?.displayName ?? "Someone",
      text: text[n.type as keyof typeof text] ?? "",
      at: n.createdAt.toISOString(),
      photo: n.actorId ? await primaryPhoto(db, n.actorId, storage) : null,
    })),
  );
  return { matches: matchDtos, activity };
}

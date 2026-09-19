/**
 * Desktop Discover side panel: the viewer's newest matches and recent activity, from real rows.
 * Photos are the other person's primary thumb through the storage provider; nothing private leaves.
 *
 * "Liked you" is the Plus paywall (§12.5), so an activity row for a like is anonymised — "Someone liked you",
 * no photo — unless the viewer holds `seeIncomingLikes`. Matches and messages already have an established
 * connection, so those rows name the other person as Chats does.
 */
import { getDb, type Db } from "@/lib/db";
import { displayablePhotoWhere } from "@/lib/photo-policy";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { isDemoKey } from "@/server/discovery/dto";
import { getEntitlements } from "@/server/entitlements";

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

/** Primary (lowest position) displayable thumb for each user, in one query; signed URLs are requested together. */
async function primaryPhotos(db: Db, userIds: string[], storage: StorageProvider): Promise<Map<string, AsidePhoto>> {
  const out = new Map<string, AsidePhoto>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return out;
  const rows = await db.profilePhoto.findMany({
    where: { profile: { userId: { in: ids } }, ...displayablePhotoWhere() },
    orderBy: [{ profileId: "asc" }, { position: "asc" }],
    distinct: ["profileId"],
    select: { thumbKey: true, blurhash: true, profile: { select: { userId: true } } },
  });
  await Promise.all(
    rows.map(async (ph) => {
      const userId = ph.profile.userId;
      if (isDemoKey(ph.thumbKey)) out.set(userId, { url: null, demoKey: ph.thumbKey, blurhash: ph.blurhash });
      else out.set(userId, { url: await storage.getReadUrl(ph.thumbKey, PHOTO_URL_TTL_SECONDS), demoKey: null, blurhash: ph.blurhash });
    }),
  );
  return out;
}

export async function getDiscoverAside(actor: Actor, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<{ matches: AsideMatchDto[]; activity: AsideActivityDto[] }> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
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
  const otherIds = matches.map((m) => (m.userAId === actor.userId ? m.userBId : m.userAId));
  const photos = await primaryPhotos(db, [...otherIds, ...notifications.flatMap((n) => (n.actorId ? [n.actorId] : []))], storage);
  const matchDtos = matches.map((m, i) => {
    const other = m.userAId === actor.userId ? m.userB : m.userA;
    return { name: other.profile?.displayName ?? "Match", conversationId: m.conversation?.id ?? null, photo: photos.get(otherIds[i]!) ?? null };
  });
  const text = { LIKE_RECEIVED: "liked you", NEW_MATCH: "matched with you", MESSAGE: "sent a message" } as const;
  const canSeeLikers = notifications.some((n) => n.type === "LIKE_RECEIVED")
    ? (await getEntitlements(db, actor.userId, now)).rules.canSeeIncomingLikes
    : false;
  const activity = notifications.map((n) => {
    const named = n.type !== "LIKE_RECEIVED" || canSeeLikers;
    return {
      name: (named ? n.actor?.profile?.displayName : null) ?? "Someone",
      text: text[n.type as keyof typeof text] ?? "",
      at: n.createdAt.toISOString(),
      photo: named && n.actorId ? photos.get(n.actorId) ?? null : null,
    };
  });
  return { matches: matchDtos, activity };
}

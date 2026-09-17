/**
 * Chats list read model (Phase 7 §11–13). Two bounded queries, no N+1: conversations with the other
 * participant's public fields and displayable primary photo, plus unread counts grouped by conversation.
 */
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/lib/db";
import { displayablePhotoWhere } from "@/lib/photo-policy";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { isDemoKey } from "@/server/discovery/dto";
import { getConversationForActor } from "./messages";

export interface ChatPhotoDto {
  url: string | null;
  demoKey: string | null;
  blurhash: string;
}

export interface ChatPersonDto {
  handle: string;
  name: string;
  verified: boolean;
  photo: ChatPhotoDto | null;
}

export interface ConversationListItemDto {
  id: string;
  other: ChatPersonDto;
  lastMessage: { preview: string; at: string; fromMe: boolean } | null;
  unreadCount: number;
  /** Latest meaningful activity: last message, else the match time. */
  activityAt: string;
}

export interface ChatsListDto {
  /** Matches without any message yet, newest match first (prototype "New matches"). */
  newMatches: ConversationListItemDto[];
  /** Conversations with at least one message, most recent activity first. */
  conversations: ConversationListItemDto[];
  serverNow: string;
}

export async function photoDto(storage: StorageProvider, photo: { thumbKey: string; blurhash: string } | undefined | null): Promise<ChatPhotoDto | null> {
  if (!photo) return null;
  if (isDemoKey(photo.thumbKey)) return { url: null, demoKey: photo.thumbKey, blurhash: photo.blurhash };
  return { url: await storage.getReadUrl(photo.thumbKey, PHOTO_URL_TTL_SECONDS), demoKey: null, blurhash: photo.blurhash };
}

const PREVIEW_MAX = 90;
/** Built per call: the photo policy reads validated env, which must never run at module load (build-time page collection). */
const personSelect = () => ({
  id: true,
  profile: { select: { handle: true, displayName: true, photos: { where: displayablePhotoWhere(), orderBy: { position: "asc" as const }, take: 1, select: { thumbKey: true, blurhash: true } } } },
  verification: { select: { status: true } },
});

export async function listConversations(actor: Actor, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<ChatsListDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();

  const rows = await db.conversation.findMany({
    where: {
      status: "ACTIVE",
      participants: { some: { userId: actor.userId } },
      // Either direction of block hides the conversation from lists (history is preserved).
      NOT: {
        OR: [
          { userA: { blocksGiven: { some: { blockedId: actor.userId } } } },
          { userB: { blocksGiven: { some: { blockedId: actor.userId } } } },
          { userA: { blocksReceived: { some: { blockerId: actor.userId } } } },
          { userB: { blocksReceived: { some: { blockerId: actor.userId } } } },
        ],
      },
    },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      userAId: true,
      userBId: true,
      lastMessageAt: true,
      createdAt: true,
      match: { select: { status: true, createdAt: true } },
      messages: { where: { deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { body: true, kind: true, senderId: true, createdAt: true } },
      userA: { select: personSelect() },
      userB: { select: personSelect() },
    },
  });
  // Only conversations backed by an ACTIVE match are dating chats (PENDING intro conversations arrive in Phase 8).
  const active = rows.filter((r) => r.match?.status === "ACTIVE");

  const unreadRows =
    active.length > 0
      ? await db.$queryRaw<{ conversationId: string; n: bigint }[]>(Prisma.sql`
          SELECT m."conversationId", count(*)::bigint AS n
          FROM "Message" m
          JOIN "ConversationParticipant" cp ON cp."conversationId" = m."conversationId" AND cp."userId" = ${actor.userId}
          WHERE m."conversationId" IN (${Prisma.join(active.map((r) => r.id))})
            AND m."senderId" <> ${actor.userId} AND m."deletedAt" IS NULL
            AND (cp."lastReadAt" IS NULL OR m."createdAt" > cp."lastReadAt")
          GROUP BY m."conversationId"
        `)
      : [];
  const unread = new Map(unreadRows.map((r) => [r.conversationId, Number(r.n)]));

  const items = await Promise.all(
    active.map(async (r): Promise<ConversationListItemDto> => {
      const other = r.userAId === actor.userId ? r.userB : r.userA;
      const last = r.messages[0];
      const activityAt = r.lastMessageAt ?? r.match?.createdAt ?? r.createdAt;
      return {
        id: r.id,
        other: {
          handle: other.profile?.handle ?? "",
          name: other.profile?.displayName ?? "Match",
          verified: other.verification?.status === "VERIFIED",
          photo: await photoDto(storage, other.profile?.photos[0]),
        },
        lastMessage: last ? { preview: last.body.replace(/\s+/g, " ").slice(0, PREVIEW_MAX), at: last.createdAt.toISOString(), fromMe: last.senderId === actor.userId } : null,
        unreadCount: unread.get(r.id) ?? 0,
        activityAt: activityAt.toISOString(),
      };
    }),
  );
  return {
    newMatches: items.filter((i) => i.lastMessage === null).sort((a, b) => b.activityAt.localeCompare(a.activityAt)),
    conversations: items.filter((i) => i.lastMessage !== null).sort((a, b) => b.activityAt.localeCompare(a.activityAt)),
    serverNow: now.toISOString(),
  };
}

export interface ConversationHeaderDto {
  id: string;
  status: "ACTIVE" | "PENDING" | "LOCKED";
  other: ChatPersonDto & { location: string | null };
  /** Whether Unmatch is offered (an ACTIVE match exists). */
  canUnmatch: boolean;
  serverNow: string;
}

/** Header for one conversation: the other participant's safe public fields only, honouring hideLocation. */
export async function getConversationHeader(actor: Actor, conversationId: string, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<ConversationHeaderDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const conversation = await getConversationForActor(db, actor, conversationId);
  const [other, match] = await Promise.all([
    db.user.findUnique({
      where: { id: conversation.otherUserId },
      select: {
        privacy: { select: { hideLocation: true } },
        verification: { select: { status: true } },
        profile: { select: { handle: true, displayName: true, location: { select: { name: true } }, photos: { where: displayablePhotoWhere(), orderBy: { position: "asc" }, take: 1, select: { thumbKey: true, blurhash: true } } } },
      },
    }),
    conversation.matchId ? db.match.findUnique({ where: { id: conversation.matchId }, select: { status: true } }) : null,
  ]);
  return {
    id: conversation.id,
    status: conversation.status,
    other: {
      handle: other?.profile?.handle ?? "",
      name: other?.profile?.displayName ?? "Match",
      verified: other?.verification?.status === "VERIFIED",
      location: other?.privacy?.hideLocation ? null : (other?.profile?.location?.name ?? null),
      photo: await photoDto(storage, other?.profile?.photos[0]),
    },
    canUnmatch: conversation.status === "ACTIVE" && match?.status === "ACTIVE",
    serverNow: now.toISOString(),
  };
}

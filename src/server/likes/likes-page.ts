/**
 * The Likes tab as the browser sees it (docs/ARCHITECTURE.md §12.5): Likes You for the viewer's tier, and the
 * viewer's active matches. Free receives a count and anonymised placeholders (a blurhash and a verified flag, nothing
 * that identifies anyone, in random order); Plus receives the same safe card DTO Discover uses. Authorization happens
 * here, in getLikesYou, never by hiding fields in the browser.
 */
import { getDb, type Db } from "@/lib/db";
import { displayablePhotoWhere } from "@/lib/photo-policy";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { isDemoKey, toDiscoveryCard, type DiscoveryCardDto } from "@/server/discovery/dto";
import { getLikesYou, type LikesYouPlaceholder } from "./likes-you";

export interface LikesMatchDto {
  handle: string;
  name: string;
  verified: boolean;
  conversationId: string | null;
  matchedAt: string;
  photo: { url: string | null; demoKey: string | null; blurhash: string } | null;
}

export type LikesYouPageDto =
  | { tier: "FREE"; count: number; placeholders: LikesYouPlaceholder[]; cards: null; matches: LikesMatchDto[]; serverNow: string }
  | { tier: "PLUS"; count: number; placeholders: null; cards: DiscoveryCardDto[]; matches: LikesMatchDto[]; serverNow: string };

export async function getLikesPage(actor: Actor, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<LikesYouPageDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const [likes, matches] = await Promise.all([getLikesYou(actor, { db, now }), listMatches(actor, db, storage)]);
  if (likes.tier === "FREE") return { tier: "FREE", count: likes.count, placeholders: likes.placeholders, cards: null, matches, serverNow: now.toISOString() };
  const cards = await Promise.all(likes.profiles.map((p) => toDiscoveryCard(p, storage)));
  return { tier: "PLUS", count: likes.count, placeholders: null, cards, matches, serverNow: now.toISOString() };
}

async function listMatches(actor: Actor, db: Db, storage: StorageProvider): Promise<LikesMatchDto[]> {
  const rows = await db.match.findMany({
    // Both sides must be dating members. A match with an operational account cannot be created in the first
    // place, and conversion refuses to run while one exists, so this only ever fires on malformed data (§22.5).
    where: {
      status: "ACTIVE",
      OR: [{ userAId: actor.userId }, { userBId: actor.userId }],
      userA: { accountType: "MEMBER" },
      userB: { accountType: "MEMBER" },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      createdAt: true,
      userAId: true,
      userBId: true,
      conversation: { select: { id: true } },
      userA: { select: { verification: { select: { status: true } }, profile: { select: { handle: true, displayName: true, photos: { where: displayablePhotoWhere(), orderBy: { position: "asc" }, take: 1, select: { thumbKey: true, blurhash: true } } } } } },
      userB: { select: { verification: { select: { status: true } }, profile: { select: { handle: true, displayName: true, photos: { where: displayablePhotoWhere(), orderBy: { position: "asc" }, take: 1, select: { thumbKey: true, blurhash: true } } } } } },
    },
  });
  return Promise.all(
    rows.map(async (m) => {
      const other = m.userAId === actor.userId ? m.userB : m.userA;
      const ph = other.profile?.photos[0];
      const photo = ph ? (isDemoKey(ph.thumbKey) ? { url: null, demoKey: ph.thumbKey, blurhash: ph.blurhash } : { url: await storage.getReadUrl(ph.thumbKey, PHOTO_URL_TTL_SECONDS), demoKey: null, blurhash: ph.blurhash }) : null;
      return { handle: other.profile?.handle ?? "", name: other.profile?.displayName ?? "Member", verified: other.verification?.status === "VERIFIED", conversationId: m.conversation?.id ?? null, matchedAt: m.createdAt.toISOString(), photo };
    }),
  );
}

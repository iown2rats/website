/**
 * The other participant's safe profile for the conversation header (Phase 7 §26). Authorised through the
 * conversation (participant, not blocked), then built from VisibleProfile, which applies hideAge/hideLocation
 * and the photo visibility policy. Deliberately NOT the discovery predicate: Invisible Mode never hides a match.
 */
import { getDb, type Db } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { buildDiscoveryCards, type DiscoveryCardDto } from "@/server/discovery/dto";
import { getConversationForActor } from "./messages";

export async function getMatchProfile(actor: Actor, conversationId: string, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<DiscoveryCardDto | null> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const conversation = await getConversationForActor(db, actor, conversationId);
  const [card] = await buildDiscoveryCards(db, actor.userId, [conversation.otherUserId], now, storage, { requireMinPhotos: false });
  return card ?? null;
}

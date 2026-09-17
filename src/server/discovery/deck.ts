/**
 * The Discover deck as the client sees it: bounded batches of safe cards plus the like allowance and server time.
 * Actions accept public handles and resolve them here; the acting user always comes from the session.
 */
import { DISCOVERY } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { getEntitlements, getLikeAllowance, type LikeAllowance } from "@/server/entitlements";
import { likeUser, passUser, undoLastPass, type LikeResult } from "@/server/likes/like";
import { buildDiscoveryCards, isDemoKey, type DiscoveryCardDto } from "./dto";
import { countRelaxedCandidates, getDeckCandidateIds, isDeckCandidate } from "./query";

export interface DeckDeps {
  db?: Db;
  storage?: StorageProvider;
  now?: Date;
}

export interface AllowanceDto {
  limit: number;
  used: number;
  remaining: number;
  /** ISO time the current window ends; null when no window is open (full allowance). */
  resetsAt: string | null;
  tier: "FREE" | "PLUS";
}

export interface DeckCapabilities {
  canUndo: boolean;
  canUseAdvancedFilters: boolean;
  tier: "FREE" | "PLUS";
}

export type EmptyReason = "NONE" | "FILTERS" | "EXHAUSTED";

export interface DeckPage {
  cards: DiscoveryCardDto[];
  allowance: AllowanceDto;
  capabilities: DeckCapabilities;
  /** Authoritative server time; the client renders countdowns relative to this, never to its own clock alone. */
  serverNow: string;
  /** Only meaningful when `cards` is empty: FILTERS = relaxing your filters would show people, EXHAUSTED = nobody new. */
  emptyReason: EmptyReason;
  /** The viewer's own primary photo for the match screen. */
  me: { name: string; photo: { url: string | null; demoKey: string | null; blurhash: string } | null };
}

export function toAllowanceDto(a: LikeAllowance): AllowanceDto {
  return { limit: a.limit, used: a.used, remaining: a.remaining, resetsAt: a.resetsAt ? a.resetsAt.toISOString() : null, tier: a.tier };
}

async function resolveHandles(db: DbLike, handles: string[]): Promise<string[]> {
  if (handles.length === 0) return [];
  const rows = await db.profile.findMany({ where: { handle: { in: handles.slice(0, DISCOVERY.maxExcludeHandles) } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

export async function resolveHandle(db: DbLike, handle: string): Promise<string> {
  const row = await db.profile.findUnique({ where: { handle }, select: { userId: true } });
  if (!row) throw new NotFoundError("Profile");
  return row.userId;
}

async function loadMe(db: DbLike, actor: Actor, storage: StorageProvider): Promise<DeckPage["me"]> {
  const profile = await db.profile.findUnique({
    where: { userId: actor.userId },
    select: { displayName: true, photos: { where: { moderation: { in: [...DISCOVERY.displayableModeration] } }, orderBy: { position: "asc" }, take: 1, select: { thumbKey: true, blurhash: true } } },
  });
  const first = profile?.photos[0];
  if (!profile) return { name: "", photo: null };
  if (!first) return { name: profile.displayName, photo: null };
  if (isDemoKey(first.thumbKey)) return { name: profile.displayName, photo: { url: null, demoKey: first.thumbKey, blurhash: first.blurhash } };
  return { name: profile.displayName, photo: { url: await storage.getReadUrl(first.thumbKey, PHOTO_URL_TTL_SECONDS), demoKey: null, blurhash: first.blurhash } };
}

/** One batch of the deck. `excludeHandles` are cards the client still holds. */
export async function getDeck(actor: Actor, input: { excludeHandles?: string[]; limit?: number } = {}, deps: DeckDeps = {}): Promise<DeckPage> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const excludeIds = await resolveHandles(db, input.excludeHandles ?? []);
  const [ids, allowance, entitlements, me] = await Promise.all([
    getDeckCandidateIds(db, actor, { now, limit: input.limit, excludeIds }),
    getLikeAllowance(db, actor.userId, now),
    getEntitlements(db, actor.userId, now),
    loadMe(db, actor, storage),
  ]);
  const cards = await buildDiscoveryCards(db, actor.userId, ids, now, storage);
  let emptyReason: EmptyReason = "NONE";
  if (cards.length === 0 && excludeIds.length === 0) {
    emptyReason = (await countRelaxedCandidates(db, actor, now)) > 0 ? "FILTERS" : "EXHAUSTED";
  }
  return {
    cards,
    allowance: toAllowanceDto(allowance),
    capabilities: { canUndo: entitlements.rules.canUndoPass, canUseAdvancedFilters: entitlements.rules.canUseAdvancedFilters, tier: entitlements.tier },
    serverNow: now.toISOString(),
    emptyReason,
    me,
  };
}

export interface MatchDto {
  matchId: string;
  conversationId: string | null;
  /** The other person, for the match screen. */
  card: DiscoveryCardDto;
}

export interface LikeOutcome {
  created: boolean;
  matched: boolean;
  match: MatchDto | null;
  allowance: AllowanceDto;
  serverNow: string;
}

/** Like by public handle. Throws the domain errors from likeUser (limit, not found). */
export async function likeByHandle(actor: Actor, handle: string, deps: DeckDeps = {}): Promise<LikeOutcome> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const targetId = await resolveHandle(db, handle);
  const result: LikeResult = await likeUser(actor, targetId, { db, now });
  let match: MatchDto | null = null;
  if (result.matched && result.matchId) {
    const [card] = await buildDiscoveryCards(db, actor.userId, [targetId], now, storage);
    if (card) match = { matchId: result.matchId, conversationId: result.conversationId, card };
  }
  const allowance = await getLikeAllowance(db, actor.userId, now);
  return { created: result.created, matched: result.matched && match != null, match, allowance: toAllowanceDto(allowance), serverNow: now.toISOString() };
}

export async function passByHandle(actor: Actor, handle: string, deps: DeckDeps = {}): Promise<{ created: boolean; serverNow: string }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const targetId = await resolveHandle(db, handle);
  const result = await passUser(actor, targetId, { db, now });
  return { created: result.created, serverNow: now.toISOString() };
}

export interface UndoOutcome {
  /** The restored profile as a card, or null when it is no longer a valid candidate (e.g. they blocked you). */
  card: DiscoveryCardDto | null;
  serverNow: string;
}

/** Undo (Plus, server-enforced): reverses the most recent eligible pass and returns the card to put back on top. */
export async function undoAndRestore(actor: Actor, deps: DeckDeps = {}): Promise<UndoOutcome> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const { restoredUserId } = await undoLastPass(actor, { db, now });
  const eligible = await isDeckCandidate(db, actor, restoredUserId, now);
  if (!eligible) return { card: null, serverNow: now.toISOString() };
  const [card] = await buildDiscoveryCards(db, actor.userId, [restoredUserId], now, storage);
  return { card: card ?? null, serverNow: now.toISOString() };
}

export async function getAllowance(actor: Actor, deps: DeckDeps = {}): Promise<{ allowance: AllowanceDto; serverNow: string }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return { allowance: toAllowanceDto(await getLikeAllowance(db, actor.userId, now)), serverNow: now.toISOString() };
}

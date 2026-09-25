/**
 * The Discover deck as the client sees it: bounded batches of safe cards plus the like allowance and server time.
 * Actions accept public handles and resolve them here; the acting user always comes from the session.
 */
import { DISCOVERY, PRODUCT_RULES } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { displayablePhotoWhere } from "@/lib/photo-policy";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { getBoostAllowance, getEntitlements, getLikeAllowance, type LikeAllowance } from "@/server/entitlements";
import { flagEnabled } from "@/server/flags";
import { countEligibleIncomingLikes } from "@/server/likes/eligibility";
import { likeUser, passUser, undoLastPass, type LikeResult } from "@/server/likes/like";
import { kickMatchEmail } from "@/server/notifications/engagement-email";
import { kickPush } from "@/server/notifications/push";
import { buildDiscoveryCards, isDemoKey, type DiscoveryCardDto } from "./dto";
import { countAwaitingPhotoReview, countRelaxedCandidates, countSwipedCompatible, getDeckCandidateIds, isDeckCandidate } from "./query";

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
  /** Plus's daily like allowance, from the product rules, for the Free like-limit copy. Never hard-coded in the UI. */
  plusDailyLikeLimit: number;
  /**
   * Whether to draw the Undo control. Always for Plus (unchanged); for Free only while PLUS_UNDO_UI is on, where a tap
   * asks the server and a refusal explains Plus. Drawing it is never permission: `undoLastPass` decides.
   */
  showUndo: boolean;
}

/** Boost state for the Discover header (docs/ARCHITECTURE.md §12.8). Free: limit 0. */
export interface BoostDto {
  limit: number;
  remaining: number;
  /** ISO end of the active boost, or null. */
  activeEndsAt: string | null;
  /** ISO end of the rolling 7-day window, or null when none is open. */
  resetsAt: string | null;
}

export type EmptyReason = "NONE" | "FILTERS" | "REVIEW" | "EXHAUSTED" | "UNAVAILABLE" | "PAUSED";

export interface DeckPage {
  cards: DiscoveryCardDto[];
  allowance: AllowanceDto;
  capabilities: DeckCapabilities;
  boost: BoostDto;
  /** Authoritative server time; the client renders countdowns relative to this, never to its own clock alone. */
  serverNow: string;
  /**
   * Only meaningful when `cards` is empty. FILTERS = relaxing your filters would show people; REVIEW = people are
   * waiting on photo moderation, so the deck will refill without the viewer changing anything; EXHAUSTED = the viewer
   * has already acted on everybody compatible; UNAVAILABLE = nobody compatible is here right now at all; PAUSED = the
   * viewer paused dating. None of them carries a count, an identity, or anything about another member's preferences.
   */
  emptyReason: EmptyReason;
  /**
   * The Discover Likes You prompt (Option A, §12.19): the eligible incoming-likes count for a FREE member while
   * PLUS_DISCOVER_PROMPT is on and the count is at least one; otherwise null. Never for Plus, never zero, and never an
   * identity — the client shows it only inside an empty deck state.
   */
  likesTeaser: { count: number } | null;
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
    select: { displayName: true, photos: { where: displayablePhotoWhere(), orderBy: { position: "asc" }, take: 1, select: { thumbKey: true, blurhash: true } } },
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
  const privacy = await db.privacySettings.findUnique({ where: { userId: actor.userId }, select: { visibility: true, pausedAt: true } });
  const paused = privacy?.visibility === "HIDDEN" || Boolean(privacy?.pausedAt);
  const [ids, allowance, entitlements, me, boost] = await Promise.all([
    paused ? Promise.resolve([] as string[]) : getDeckCandidateIds(db, actor, { now, limit: input.limit, excludeIds }),
    getLikeAllowance(db, actor.userId, now),
    getEntitlements(db, actor.userId, now),
    loadMe(db, actor, storage),
    getBoostAllowance(db, actor.userId, now),
  ]);
  const cards = await buildDiscoveryCards(db, actor.userId, ids, now, storage);
  // The same count Likes You shows (src/server/likes/eligibility.ts). Only asked for when it could be shown.
  const teaserCount = flagEnabled("PLUS_DISCOVER_PROMPT") && !entitlements.rules.canSeeIncomingLikes ? await countEligibleIncomingLikes(db, actor.userId, now) : 0;
  let emptyReason: EmptyReason = "NONE";
  if (paused) emptyReason = "PAUSED";
  else if (cards.length === 0 && excludeIds.length === 0) {
    // Order matters: the viewer's own filters come first because they are the only thing the viewer can act on.
    // "Awaiting moderation" is asked only when relaxing the filters would not help, so a moderation backlog is
    // never reported as "you have seen everyone". And "seen everyone" is said only when it is true — when there
    // are compatible people and the viewer has acted on all of them. Otherwise nobody compatible is here: a neutral
    // state that names no reason, because the reason may be somebody else's preferences (their age range, their
    // "Show me"), and those are never the viewer's to learn.
    if ((await countRelaxedCandidates(db, actor, now)) > 0) emptyReason = "FILTERS";
    else if ((await countAwaitingPhotoReview(db, actor, now)) > 0) emptyReason = "REVIEW";
    else emptyReason = (await countSwipedCompatible(db, actor, now)) > 0 ? "EXHAUSTED" : "UNAVAILABLE";
  }
  return {
    cards,
    allowance: toAllowanceDto(allowance),
    capabilities: {
      canUndo: entitlements.rules.canUndoPass,
      canUseAdvancedFilters: entitlements.rules.canUseAdvancedFilters,
      tier: entitlements.tier,
      plusDailyLikeLimit: PRODUCT_RULES.PLUS.dailyLikeLimit,
      showUndo: entitlements.rules.canUndoPass || flagEnabled("PLUS_UNDO_UI"),
    },
    boost: { limit: boost.limit, remaining: boost.remaining, activeEndsAt: boost.activeBoostEndsAt?.toISOString() ?? null, resetsAt: boost.resetsAt?.toISOString() ?? null },
    serverNow: now.toISOString(),
    emptyReason,
    likesTeaser: teaserCount > 0 ? { count: teaserCount } : null,
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
  /*
   * The push, after the transaction and never awaited (docs/ARCHITECTURE.md §29.1). Both the "someone likes you"
   * and the "it's a match" notifications for the OTHER person were written by the call above, so this is the
   * moment they can reach a phone; the engine decides for itself whether they are away and whether they asked
   * for it. Nothing is kicked for the actor, who is by definition in the app right now.
   */
  kickPush(targetId, { db });
  /*
   * And the match email, on the same terms: after the transaction, never awaited (ARCHITECTURE §12.16b). Only the
   * TARGET is kicked — the actor is, by definition, in the app this very second, so a send for them would be a
   * round trip that could only answer "present". The sweep collects them if they leave without opening it.
   */
  if (result.matched && result.conversationId) kickMatchEmail({ recipientId: targetId, conversationId: result.conversationId }, { db });
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

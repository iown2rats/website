"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { likeCard, loadDeck, passCard, refreshAllowance, saveFilters, undoLastCard, type ActionFailure } from "@/actions/discovery";
import { DISCOVERY } from "@/config/product";
import { formatDuration } from "@/lib/time";
import type { PhotoRef } from "@/lib/photos";
import { IconButton } from "@/components/ui/button";
import { FilterIcon, HeartIcon } from "@/components/ui/icons";
import { PlusLockSheet } from "@/components/ui/plus-lock";
import { useToast } from "@/components/ui/toast";
import { AppScreen, DiscoveryFrame } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import type { AllowanceDto, BoostDto, DeckCapabilities, DeckPage, EmptyReason } from "@/server/discovery/deck";
import { BoostControl } from "./boost-control";
import type { DiscoveryFiltersDto } from "@/server/discovery/filters";
import { DeckAwaitingReview, DeckError, DeckExhausted, DeckFiltered, DeckLoading, LikesExhaustedNote, DeckPaused } from "./deck-states";
import { FiltersSheet, type FiltersDraft, type LocationOption } from "./filters-sheet";
import { FullProfile } from "./full-profile";
import { LikeLimitDialog } from "./like-limit-dialog";
import { MatchOverlay } from "./match-overlay";
import { SwipeDeck } from "./swipe-deck";
import { toDeckCard, type CardProfile, type DeckCard } from "./types";
import { useServerClock } from "./use-server-clock";

/*
 * Discover orchestration (Phase 6). The server owns eligibility, allowance, matching and history; this component
 * keeps a bounded local deck, applies decisions optimistically and reconciles on every response:
 *  - like/pass remove the head immediately; a rejected like puts the card back and shows why
 *  - the next batch is requested when `refillThreshold` cards remain, excluding the handles still held
 *  - the allowance and countdowns come from server time (useServerClock)
 *
 * At the desktop tier the whole screen — header row and deck — is one 560 px column centred between the sidebar and
 * the activity panel. Capping only the deck would leave the likes pill, Boost and Filters stranded against the far
 * edge of a much wider main column, pointing at a card several hundred pixels away.
 */
export interface DiscoverClientProps {
  initial: DeckPage;
  filters: DiscoveryFiltersDto;
  locations: LocationOption[];
}

type DeckStatus = "ready" | "loading" | "error";

const dedupe = (cards: DeckCard[]) => {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.handle) ? false : (seen.add(c.handle), true)));
};

export function DiscoverClient({ initial, filters: initialFilters, locations }: DiscoverClientProps) {
  const router = useRouter();
  const toast = useToast();
  const { sync, serverTime } = useServerClock(initial.serverNow);

  const [cards, setCards] = useState<DeckCard[]>(() => initial.cards.map(toDeckCard));
  const [status, setStatus] = useState<DeckStatus>("ready");
  const [emptyReason, setEmptyReason] = useState<EmptyReason>(initial.emptyReason);
  const [exhausted, setExhausted] = useState(initial.cards.length === 0);
  const [allowance, setAllowance] = useState<AllowanceDto>(initial.allowance);
  const [capabilities] = useState<DeckCapabilities>(initial.capabilities);
  const [filters, setFilters] = useState(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersSaving, setFiltersSaving] = useState(false);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [openProfile, setOpenProfile] = useState<DeckCard | null>(null);
  const [match, setMatch] = useState<{ name: string; photo: PhotoRef | null; conversationId: string | null } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [boost, setBoost] = useState<BoostDto>(initial.boost);
  const [lock, setLock] = useState<{ feature: string; description: string } | null>(null);
  const loadingMore = useRef(false);
  const cardsRef = useRef<DeckCard[]>(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const myPhoto: PhotoRef | null = initial.me.photo ? { url: initial.me.photo.url, thumbUrl: initial.me.photo.url, key: initial.me.photo.demoKey, blurhash: initial.me.photo.blurhash } : null;

  const applyFailure = useCallback(
    (f: ActionFailure) => {
      sync(f.serverNow);
      if (f.allowance) setAllowance(f.allowance);
    },
    [sync],
  );

  /** Fetches the next batch, excluding what is still on screen (or an explicit list, e.g. nothing after a filter change). */
  const loadMore = useCallback(
    async (reason: "initial" | "refill" | "retry" = "refill", excludeOverride?: string[]) => {
      if (loadingMore.current) return;
      loadingMore.current = true;
      if (reason !== "refill") setStatus("loading");
      const held = excludeOverride ?? cardsRef.current.map((c) => c.handle);
      const result = await loadDeck({ excludeHandles: held.slice(0, DISCOVERY.maxExcludeHandles) }).catch((): ActionFailure => ({ ok: false, code: "ERROR", message: "", serverNow: new Date().toISOString() }));
      loadingMore.current = false;
      if (!result.ok) {
        if (reason !== "refill") setStatus("error");
        else toast.show("Couldn't load more profiles. We'll try again.");
        return;
      }
      sync(result.serverNow);
      setAllowance(result.allowance);
      const fresh = result.cards.map(toDeckCard);
      setCards((prev) => dedupe([...prev, ...fresh]));
      if (fresh.length === 0) {
        setExhausted(true);
        if (held.length === 0) setEmptyReason(result.emptyReason);
      } else {
        setExhausted(false);
        setEmptyReason("NONE");
      }
      setStatus("ready");
    },
    [sync, toast],
  );

  // Refill before the deck runs dry (deferred a tick so the fetch never runs inside the render commit).
  useEffect(() => {
    if (!(status === "ready" && !exhausted && cards.length <= DISCOVERY.refillThreshold)) return;
    const id = setTimeout(() => void loadMore("refill"), 0);
    return () => clearTimeout(id);
  }, [cards.length, exhausted, status, loadMore]);

  const removeHead = (handle: string) => setCards((prev) => (prev[0]?.handle === handle ? prev.slice(1) : prev.filter((c) => c.handle !== handle)));
  const restore = (card: DeckCard) => setCards((prev) => dedupe([card, ...prev]));

  const onLike = useCallback(
    async (profile: CardProfile) => {
      const card = profile as DeckCard;
      setOpenProfile(null);
      if (allowance.remaining <= 0 && allowance.resetsAt && Date.parse(allowance.resetsAt) > serverTime()) {
        // Known-exhausted: don't even send it; the server would refuse anyway.
        setLimitOpen(true);
        return;
      }
      removeHead(card.handle);
      const result = await likeCard({ handle: card.handle }).catch((): ActionFailure => ({ ok: false, code: "ERROR", message: "", serverNow: new Date().toISOString() }));
      if (!result.ok) {
        applyFailure(result);
        if (result.code === "LIKE_LIMIT") {
          restore(card);
          setLimitOpen(true);
        } else if (result.code === "NOT_FOUND") {
          toast.show("That profile isn't available any more.");
        } else {
          restore(card);
          toast.show("Couldn't reach Mellocrush. Try again.");
        }
        return;
      }
      sync(result.serverNow);
      setAllowance(result.allowance);
      if (result.matched && result.match) {
        const them = toDeckCard(result.match.card);
        setMatch({ name: them.name, photo: them.photos[0] ?? null, conversationId: result.match.conversationId });
      }
    },
    [allowance, applyFailure, serverTime, sync, toast],
  );

  const onPass = useCallback(
    async (profile: CardProfile) => {
      const card = profile as DeckCard;
      setOpenProfile(null);
      removeHead(card.handle);
      const result = await passCard({ handle: card.handle }).catch((): ActionFailure => ({ ok: false, code: "ERROR", message: "", serverNow: new Date().toISOString() }));
      if (!result.ok) {
        applyFailure(result);
        if (result.code !== "NOT_FOUND") {
          restore(card);
          toast.show("Couldn't reach Mellocrush. Try again.");
        }
        return;
      }
      sync(result.serverNow);
    },
    [applyFailure, sync, toast],
  );

  const onUndo = useCallback(async () => {
    if (undoBusy) return;
    setUndoBusy(true);
    const result = await undoLastCard().catch((): ActionFailure => ({ ok: false, code: "ERROR", message: "", serverNow: new Date().toISOString() }));
    setUndoBusy(false);
    if (!result.ok) {
      applyFailure(result);
      if (result.code === "ENTITLEMENT") setLock({ feature: "Undo your last pass", description: "Plus brings back the person you just passed on." });
      else if (result.code === "UNDO_UNAVAILABLE") toast.show(result.message);
      else toast.show("Couldn't reach Mellocrush. Try again.");
      return;
    }
    sync(result.serverNow);
    if (result.card) {
      restore(toDeckCard(result.card));
      setExhausted(false);
      setEmptyReason("NONE");
    } else toast.show("That profile isn't available any more.");
  }, [applyFailure, sync, toast, undoBusy]);

  const onApplyFilters = async (draft: FiltersDraft) => {
    setFiltersSaving(true);
    setFiltersError(null);
    const result = await saveFilters(draft).catch((): ActionFailure => ({ ok: false, code: "ERROR", message: "Couldn't save your filters.", serverNow: new Date().toISOString() }));
    setFiltersSaving(false);
    if (!result.ok) {
      setFiltersError(result.message || "Couldn't save your filters.");
      return;
    }
    setFilters(result.filters);
    setFiltersOpen(false);
    setCards([]);
    setExhausted(false);
    setEmptyReason("NONE");
    // The previous deck is gone: exclude nothing, so the new filters get a full first batch and a true empty reason.
    await loadMore("initial", []);
  };

  const onCountdownDone = useCallback(async () => {
    const result = await refreshAllowance().catch(() => null);
    if (result && result.ok) {
      sync(result.serverNow);
      setAllowance(result.allowance);
      if (result.allowance.remaining > 0) setLimitOpen(false);
    }
  }, [sync]);

  const likesExhausted = allowance.remaining <= 0 && allowance.resetsAt != null && Date.parse(allowance.resetsAt) > serverTime();
  const msUntilReset = allowance.resetsAt ? Date.parse(allowance.resetsAt) - serverTime() : null;

  const empty =
    status === "loading" ? <DeckLoading /> :
    status === "error" ? <DeckError onRetry={() => void loadMore("retry")} /> :
    likesExhausted && emptyReason === "EXHAUSTED" ? <LikesExhaustedNote limit={allowance.limit} msUntilReset={msUntilReset} /> :
    emptyReason === "PAUSED" ? <DeckPaused /> :
    emptyReason === "FILTERS" ? <DeckFiltered onAdjustFilters={() => setFiltersOpen(true)} /> :
    emptyReason === "REVIEW" ? <DeckAwaitingReview onRefresh={() => void loadMore("retry")} /> :
    <DeckExhausted onAdjustFilters={() => setFiltersOpen(true)} onRefresh={() => void loadMore("retry")} />;

  return (
    <AppScreen aria-label="Discover" className="wide:mx-auto wide:w-full wide:max-w-[var(--deck-wide)]">
      <TabHeader
        logo
        compactLogo={boost.activeEndsAt != null && Date.parse(boost.activeEndsAt) > serverTime()}
        title="Discover"
        actions={
          <>
            <AllowancePill allowance={allowance} msUntilReset={msUntilReset} onClick={() => likesExhausted && setLimitOpen(true)} />
            <BoostControl boost={boost} tier={capabilities.tier} serverTime={serverTime} onSync={sync} onBoosted={setBoost} onLocked={() => setLock({ feature: "Boost your profile", description: "Plus puts your profile first in Discover for 30 minutes." })} />
            <IconButton aria-label="Filters" onClick={() => setFiltersOpen(true)}>
              <FilterIcon size={20} />
            </IconButton>
          </>
        }
      />
      <DiscoveryFrame>
        <SwipeDeck
          profiles={cards}
          onLike={onLike}
          onPass={onPass}
          onOpen={(p) => setOpenProfile(p as DeckCard)}
          onUndo={capabilities.canUndo ? onUndo : undefined}
          undoDisabled={undoBusy}
          empty={empty}
          disabled={limitOpen || match != null}
          guide
          remainingHint={likesExhausted ? `You've used today's ${allowance.limit} likes. Passing still works.` : `${allowance.remaining} likes left today.`}
        />
      </DiscoveryFrame>

      {openProfile ? (
        <FullProfile
          profile={openProfile}
          onClose={() => setOpenProfile(null)}
          onPass={cards[0]?.handle === openProfile.handle ? () => void onPass(openProfile) : undefined}
          onLike={cards[0]?.handle === openProfile.handle ? () => void onLike(openProfile) : undefined}
          onUnlockPhotos={() => setLock({ feature: "See all their photos", description: "Plus opens the rest of their photos before you match." })}
        />
      ) : null}

      <MatchOverlay
        open={match != null}
        name={match?.name ?? ""}
        theirPhoto={match?.photo ?? null}
        myPhoto={myPhoto}
        onSayHello={() => {
          const id = match?.conversationId;
          setMatch(null);
          router.push(id ? `/chats/${id}` : "/chats");
        }}
        onKeepSwiping={() => setMatch(null)}
      />

      <LikeLimitDialog
        open={limitOpen}
        onClose={() => setLimitOpen(false)}
        limit={allowance.limit}
        plusLimit={capabilities.plusDailyLikeLimit}
        tier={allowance.tier}
        resetsAt={allowance.resetsAt}
        serverTime={serverTime}
        onCountdownDone={onCountdownDone}
        onGetPlus={() => { setLimitOpen(false); router.push("/settings/membership"); }}
      />

      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        locations={locations}
        saving={filtersSaving}
        error={filtersError}
        onApply={onApplyFilters}
        onLockedAdvanced={() => setLock({ feature: "Advanced filters", description: "Plus adds height and education to your filters." })}
      />
      <PlusLockSheet open={lock != null} onClose={() => setLock(null)} feature={lock?.feature ?? ""} description={lock?.description ?? ""} />
    </AppScreen>
  );
}

/** Compact allowance counter in the header: "28 likes left", or the reset countdown when exhausted. */
function AllowancePill({ allowance, msUntilReset, onClick }: { allowance: AllowanceDto; msUntilReset: number | null; onClick: () => void }) {
  const exhausted = allowance.remaining <= 0 && msUntilReset != null && msUntilReset > 0;
  const label = exhausted ? `Likes back in ${formatDuration(msUntilReset)}` : `${allowance.remaining} likes left`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={exhausted ? `You've used today's ${allowance.limit} likes. ${label}.` : `${allowance.remaining} of ${allowance.limit} likes left today`}
      data-testid="allowance-pill"
      className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-surface-muted px-2.5 text-caption font-medium text-text tabular-nums"
    >
      <HeartIcon size={14} filled strokeWidth={0} className={exhausted ? "text-text-muted" : "text-primary-ink"} />
      {label}
    </button>
  );
}

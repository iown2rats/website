"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { likeCard, loadDeck, passCard, refreshAllowance, saveFilters, superLikeCard, undoLastCard, type ActionFailure } from "@/actions/discovery";
import { DISCOVERY, PRODUCT_RULES } from "@/config/product";
import { membershipHref, type PlusSurface } from "@/lib/plus-surfaces";
import { formatDuration } from "@/lib/time";
import type { PhotoRef } from "@/lib/photos";
import { IconButton } from "@/components/ui/button";
import { FilterIcon, HeartIcon } from "@/components/ui/icons";
import { PlusLockSheet } from "@/components/ui/plus-lock";
import { useToast } from "@/components/ui/toast";
import { AppScreen, DiscoveryFrame } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import type { AllowanceDto, BoostDto, DeckCapabilities, DeckPage, EmptyReason, SuperLikeAllowanceDto } from "@/server/discovery/deck";
import type { VerificationReminderDto } from "@/server/verification/reminder";
import { BoostControl } from "./boost-control";
import type { DiscoveryFiltersDto } from "@/server/discovery/filters";
import { DeckAwaitingReview, DeckError, DeckExhausted, DeckFiltered, DeckLoading, DeckUnavailable, LikesExhaustedNote, LikesYouPrompt, DeckPaused } from "./deck-states";
import { trackPlusClick, trackSuperLikeComposerOpened, usePlusPromptView } from "@/components/features/analytics/plus-track";
import { FiltersSheet, type FiltersDraft, type LocationOption } from "./filters-sheet";
import { VerificationReminder } from "./verification-reminder";
import { FullProfile } from "./full-profile";
import { LikeLimitDialog } from "./like-limit-dialog";
import { MatchOverlay } from "./match-overlay";
import { SuperLikeComposer, SuperLikesUsedDialog } from "./super-like";
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
  /** Present only when the server decided this member should be reminded to verify (src/server/verification/reminder.ts). */
  verificationReminder?: VerificationReminderDto | null;
}

type DeckStatus = "ready" | "loading" | "error";

/** Dismissing the Discover Likes You prompt lasts for the browser session. Storage failures just mean it can reappear. */
const PROMPT_DISMISSED_KEY = "mc:discover-likes-prompt-dismissed";
const noopSubscribe = () => () => {};
function readPromptDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(PROMPT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
function writePromptDismissed(): void {
  try {
    window.sessionStorage.setItem(PROMPT_DISMISSED_KEY, "1");
  } catch {
    /* Private mode or storage disabled: the in-memory flag still hides it for this visit. */
  }
}

const dedupe = (cards: DeckCard[]) => {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.handle) ? false : (seen.add(c.handle), true)));
};

export function DiscoverClient({ initial, filters: initialFilters, locations, verificationReminder }: DiscoverClientProps) {
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
  const [likesTeaser, setLikesTeaser] = useState(initial.likesTeaser);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const promptDismissedStored = useSyncExternalStore(noopSubscribe, readPromptDismissed, () => false);
  const [lock, setLock] = useState<{ feature: string; description: string; surface?: PlusSurface; detail?: string } | null>(null);
  const [superLikes, setSuperLikes] = useState<SuperLikeAllowanceDto>(initial.superLikes);
  const [composeFor, setComposeFor] = useState<DeckCard | null>(null);
  const [superSending, setSuperSending] = useState(false);
  const [superError, setSuperError] = useState<string | null>(null);
  const [superUsedOpen, setSuperUsedOpen] = useState(false);
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
      if (f.superLikes) setSuperLikes(f.superLikes);
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
      setSuperLikes(result.superLikes);
      setLikesTeaser(result.likesTeaser);
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
          toast.show("Couldn't reach MelloCrush. Try again.");
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
          toast.show("Couldn't reach MelloCrush. Try again.");
        }
        return;
      }
      sync(result.serverNow);
    },
    [applyFailure, sync, toast],
  );

  /*
   * Super Like (§12.20). The star is on every card for everybody; what a tap does depends on the allowance the server
   * last reported: no Plus → the Plus sheet (nothing is sent), none left → when they reset (no upgrade: they already
   * have Plus), otherwise the composer. The server decides again on send, so a stale view only changes which of
   * these the member sees after the refusal.
   */
  const superLikesUsed = superLikes.limit > 0 && superLikes.remaining <= 0 && superLikes.resetsAt != null && Date.parse(superLikes.resetsAt) > serverTime();
  const onSuperLike = useCallback(
    (profile: CardProfile) => {
      const card = profile as DeckCard;
      setOpenProfile(null);
      if (superLikes.limit <= 0) {
        setLock({ feature: "Super Like ⭐", description: "Stand out and send a message with your like.", detail: `${PRODUCT_RULES.PLUS.superLikesPerWindow} Super Likes every 7 days with Plus`, surface: "super_like" });
        return;
      }
      if (superLikesUsed) {
        setSuperUsedOpen(true);
        return;
      }
      setSuperError(null);
      setComposeFor(card);
      trackSuperLikeComposerOpened();
    },
    [superLikes.limit, superLikesUsed],
  );

  const onSendSuperLike = useCallback(
    async (message: string) => {
      const card = composeFor;
      if (!card || superSending) return;
      setSuperSending(true);
      setSuperError(null);
      const result = await superLikeCard({ handle: card.handle, message }).catch((): ActionFailure => ({ ok: false, code: "ERROR", message: "", serverNow: new Date().toISOString() }));
      setSuperSending(false);
      if (!result.ok) {
        applyFailure(result);
        switch (result.code) {
          case "VALIDATION":
            // The composer stays open with their text so they can shorten it.
            setSuperError(result.message || "Keep your message to 150 characters.");
            return;
          case "ENTITLEMENT":
            setComposeFor(null);
            setLock({ feature: "Super Like ⭐", description: "Stand out and send a message with your like.", detail: `${PRODUCT_RULES.PLUS.superLikesPerWindow} Super Likes every 7 days with Plus`, surface: "super_like" });
            return;
          case "SUPER_LIKE_LIMIT":
            setComposeFor(null);
            setSuperUsedOpen(true);
            return;
          case "NOT_FOUND":
            setComposeFor(null);
            removeHead(card.handle);
            toast.show("That profile isn't available any more.");
            return;
          case "UNAVAILABLE":
            // Already liked (a normal like is never turned into a Super Like), paused, or no longer in their pool.
            setComposeFor(null);
            toast.show(result.message || "You can't Super Like them right now.");
            return;
          default:
            setSuperError("Couldn't reach MelloCrush. Try again.");
            return;
        }
      }
      sync(result.serverNow);
      setAllowance(result.allowance);
      setSuperLikes(result.superLikes);
      setComposeFor(null);
      removeHead(card.handle);
      if (result.matched && result.match) {
        const them = toDeckCard(result.match.card);
        setMatch({ name: them.name, photo: them.photos[0] ?? null, conversationId: result.match.conversationId });
      } else toast.show(`Super Like sent to ${card.name} ⭐`);
    },
    [applyFailure, composeFor, superSending, sync, toast],
  );

  const onUndo = useCallback(async () => {
    if (undoBusy) return;
    setUndoBusy(true);
    const result = await undoLastCard().catch((): ActionFailure => ({ ok: false, code: "ERROR", message: "", serverNow: new Date().toISOString() }));
    setUndoBusy(false);
    if (!result.ok) {
      applyFailure(result);
      if (result.code === "ENTITLEMENT") setLock({ feature: "Undo your last pass", description: "Plus brings back the person you just passed on.", surface: "undo" });
      else if (result.code === "UNDO_UNAVAILABLE") toast.show(result.message);
      else toast.show("Couldn't reach MelloCrush. Try again.");
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
      setSuperLikes(result.superLikes);
      if (result.allowance.remaining > 0) setLimitOpen(false);
    }
  }, [sync]);

  const likesExhausted = allowance.remaining <= 0 && allowance.resetsAt != null && Date.parse(allowance.resetsAt) > serverTime();
  const msUntilReset = allowance.resetsAt ? Date.parse(allowance.resetsAt) - serverTime() : null;

  const emptyState =
    status === "loading" ? <DeckLoading /> :
    status === "error" ? <DeckError onRetry={() => void loadMore("retry")} /> :
    likesExhausted && emptyReason === "EXHAUSTED" ? <LikesExhaustedNote limit={allowance.limit} msUntilReset={msUntilReset} /> :
    emptyReason === "PAUSED" ? <DeckPaused /> :
    emptyReason === "FILTERS" ? <DeckFiltered onAdjustFilters={() => setFiltersOpen(true)} /> :
    emptyReason === "REVIEW" ? <DeckAwaitingReview onRefresh={() => void loadMore("retry")} /> :
    emptyReason === "UNAVAILABLE" ? <DeckUnavailable onAdjustFilters={() => setFiltersOpen(true)} onRefresh={() => void loadMore("retry")} /> :
    <DeckExhausted onAdjustFilters={() => setFiltersOpen(true)} onRefresh={() => void loadMore("retry")} />;
  /*
   * Option A (§12.19): the Likes You prompt lives only inside a settled empty deck — nobody new, out of likes, or
   * waiting on review — where there is no card to swipe and no swipe lesson running. Never while loading, on an
   * error, while paused or when the member's own filters are the fix. The server sends a count only for a Free
   * member with at least one eligible like, and only while PLUS_DISCOVER_PROMPT is on.
   */
  const promptState = status === "ready" && cards.length === 0 && (emptyReason === "NONE" || emptyReason === "EXHAUSTED" || emptyReason === "UNAVAILABLE" || emptyReason === "REVIEW");
  const showLikesPrompt = likesTeaser != null && likesTeaser.count > 0 && promptState && !promptDismissed && !promptDismissedStored;
  usePlusPromptView("discover_likes", showLikesPrompt);
  const empty = showLikesPrompt && likesTeaser ? (
    <div className="flex h-full flex-col gap-2.5">
      <div className="min-h-0 flex-1">{emptyState}</div>
      <LikesYouPrompt
        count={likesTeaser.count}
        onOpen={() => trackPlusClick("discover_likes")}
        onDismiss={() => {
          setPromptDismissed(true);
          writePromptDismissed();
        }}
      />
    </div>
  ) : emptyState;

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
      {/* Above the deck, never over it: the deck frame is the flexible part and simply gives up the reminder's height. */}
      {verificationReminder ? <VerificationReminder dismissKey={verificationReminder.dismissKey} /> : null}
      <DiscoveryFrame>
        <SwipeDeck
          profiles={cards}
          onLike={onLike}
          onPass={onPass}
          onSuperLike={onSuperLike}
          superLikeLocked={superLikes.limit <= 0}
          onOpen={(p) => setOpenProfile(p as DeckCard)}
          onUndo={capabilities.showUndo ? onUndo : undefined}
          undoLocked={!capabilities.canUndo}
          undoDisabled={undoBusy}
          empty={empty}
          disabled={limitOpen || match != null || composeFor != null}
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
          onSuperLike={cards[0]?.handle === openProfile.handle ? () => onSuperLike(openProfile) : undefined}
          superLikeLocked={superLikes.limit <= 0}
          onUnlockPhotos={() => setLock({ feature: "See all their photos", description: "Plus opens the rest of their photos before you match.", surface: "photo_lock" })}
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
        onGetPlus={() => { setLimitOpen(false); router.push(membershipHref("daily_limit")); }}
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
      <SuperLikeComposer
        open={composeFor != null}
        onClose={() => setComposeFor(null)}
        name={composeFor?.name ?? ""}
        allowance={superLikes}
        nowMs={serverTime}
        sending={superSending}
        error={superError}
        onSend={(m) => void onSendSuperLike(m)}
      />
      <SuperLikesUsedDialog
        open={superUsedOpen}
        onClose={() => setSuperUsedOpen(false)}
        limit={superLikes.limit || PRODUCT_RULES.PLUS.superLikesPerWindow}
        resetsInMs={superLikes.resetsAt ? Date.parse(superLikes.resetsAt) - serverTime() : null}
      />
      <PlusLockSheet open={lock != null} onClose={() => setLock(null)} feature={lock?.feature ?? ""} description={lock?.description ?? ""} surface={lock?.surface}>
        {lock?.detail ? <p className="flex items-center gap-1.5 text-body-sm font-medium text-text">{lock.detail}</p> : null}
      </PlusLockSheet>
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

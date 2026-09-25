"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { likeCard, passCard, type ActionFailure } from "@/actions/discovery";
import { markLikesViewed } from "@/actions/notifications";
import { useNotifications } from "@/components/layout/notifications-context";
import type { LikeOutcome } from "@/server/discovery/deck";
import type { PhotoRef } from "@/lib/photos";
import { photoBackground } from "@/lib/photos";
import type { LikesYouPageDto } from "@/server/likes/likes-page";
import { FullProfile } from "@/components/features/discovery/full-profile";
import { MatchOverlay } from "@/components/features/discovery/match-overlay";
import { ProfileCard } from "@/components/features/discovery/profile-card";
import { SuperLikeBadge, SuperLikeNote } from "@/components/features/discovery/super-like";
import { toDeckCard, type DeckCard } from "@/components/features/discovery/types";
import { PlusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeartIcon, LockIcon, StarIcon, VerifiedBadge } from "@/components/ui/icons";
import { LockedPhoto } from "@/components/ui/locked-photo";
import { PlusLockSheet } from "@/components/ui/plus-lock";
import { EmptyState } from "@/components/ui/states";
import { SegmentedControl } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { usePlusPromptView } from "@/components/features/analytics/plus-track";

/*
 * Likes tab (docs/ARCHITECTURE.md §12.5). Likes You — Free: the count and one locked tile per like, with one way to
 * Membership; the server sent a number and nothing else, so there is nothing here to un-blur or match against any
 * other list. Plus: the real cards, opening to the full profile with Like back / Pass; a mutual like shows the match
 * screen, and Pass here is a "no" to that like (it leaves the page). Sent — every tier: the people the viewer liked
 * who have not liked back yet, as ordinary cards, with no actions (there is no withdrawing a like). Matches: the
 * viewer's active matches with a way into each chat.
 *
 * Super Likes (§12.20) come first on both lists and carry the gold star. Free is told how many (and how many came
 * with a message) and nothing else — the server sends counts, so the first tiles are starred without being anybody.
 * Plus sees who, and the message, on the full profile. Sent shows the viewer their own Super Like and message.
 */
export type LikesTab = "you" | "sent" | "matches";
type Tab = LikesTab;

/*
 * The locked tiles' wash. Fixed, decorative and belonging to nobody — never a liker's photo or blurhash, which the
 * server no longer sends. Cycled by position so the grid does not look like one tile repeated.
 */
const LOCKED_TILE_HASHES = ["LEHV6nWB2yk8pyo0adR*.7kCMdnj", "LKO2?U%2Tw=w]~RBVZRi};RPxuwH", "L6PZfSi_.AyE_3t7t7R**0o#DgR4", "LGF5]+Yk^6#M@-5c,1J5@[or[Q6."] as const;
const LOCKED_TILE_CAP = 100;

export function LikesClient({ initial, initialTab, myPhoto, source = "likes_you" }: { initial: LikesYouPageDto; initialTab: Tab; myPhoto: PhotoRef | null; /** The promotion that brought the member here: the Discover prompt keeps its credit through to checkout. */ source?: "likes_you" | "discover_likes" }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState(initial);
  const [cards, setCards] = useState<DeckCard[]>(() => (initial.cards ?? []).map(toDeckCard));
  const [sentCards, setSentCards] = useState<DeckCard[]>(() => initial.sent.cards.map(toDeckCard));
  const [openSent, setOpenSent] = useState<DeckCard | null>(null);
  /*
   * A server refresh (after a like back, or navigating here again) replaces the local view wholesale rather than
   * merging into it, so a card can never appear twice and every count is the server's own again.
   */
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setData(initial);
    setCards((initial.cards ?? []).map(toDeckCard));
    setSentCards(initial.sent.cards.map(toDeckCard));
  }
  const [open, setOpen] = useState<DeckCard | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<{ name: string; photo: PhotoRef | null; conversationId: string | null } | null>(null);

  /*
   * Looking at Likes You is seeing those likes: their notifications are marked read (§13) — only when the Likes You
   * tab is actually on screen, once per page render, up to the render's server time. The bell's count follows at
   * once and the next navigation brings the nav badge in line.
   */
  const notifications = useNotifications();
  const setUnread = notifications.setUnread;
  const markedFor = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== "you" || markedFor.current === initial.serverNow) return;
    markedFor.current = initial.serverNow;
    void markLikesViewed({ seenAt: initial.serverNow })
      .then((r) => {
        if (r.ok && r.marked > 0) {
          setUnread(r.unread);
          router.refresh();
        }
      })
      .catch(() => {});
  }, [tab, initial.serverNow, setUnread, router]);

  // Funnel (§12.19): the Free "N people like you" card is on screen. Never fires at zero or for Plus.
  usePlusPromptView(source, tab === "you" && data.tier === "FREE" && data.count > 0);

  const remove = (handle: string) => {
    setCards((prev) => prev.filter((c) => c.handle !== handle));
    setData((prev) => ({ ...prev, count: Math.max(0, prev.count - 1) }) as LikesYouPageDto);
  };
  const plusSupers = data.tier === "PLUS" ? data.superLikes : {};
  const freeSupers = data.tier === "FREE" ? data.superLikes : { count: 0, withMessage: 0 };
  const sentSupers = data.sent.superLikes;

  const act = async (card: DeckCard, kind: "like" | "pass") => {
    if (busy) return;
    setBusy(true);
    const fail = (): ActionFailure => ({ ok: false, code: "ERROR", message: "", serverNow: "" });
    // Pass here is an informed "no" to this person's like, so the server dismisses the like as well (§12.5).
    const result: ({ ok: true } & Partial<LikeOutcome>) | ActionFailure = kind === "like" ? await likeCard({ handle: card.handle }).catch(fail) : await passCard({ handle: card.handle, source: "likes_you" }).catch(fail);
    setBusy(false);
    setOpen(null);
    if (!result.ok) {
      if (result.code === "LIKE_LIMIT") toast.show(result.message);
      else if (result.code === "NOT_FOUND") { remove(card.handle); toast.show("That profile isn't available any more."); }
      else toast.show(result.message || "That didn't go through.");
      return;
    }
    remove(card.handle);
    const m = kind === "like" && result.matched ? result.match ?? null : null;
    if (m) {
      const ph = m.card.photos[0];
      setMatch({ name: m.card.name, photo: ph ? { url: ph.url, thumbUrl: ph.thumbUrl, key: ph.demoKey, blurhash: ph.blurhash } : null, conversationId: m.conversationId });
    } else if (kind === "like") toast.show("Liked back");
    router.refresh();
  };

  return (
    <>
      <SegmentedControl
        label="Likes sections"
        className="mb-4 mt-2"
        value={tab}
        onChange={setTab}
        items={[
          { value: "you", label: data.count > 0 ? `Likes You (${data.count})` : "Likes You" },
          { value: "sent", label: data.sent.count > 0 ? `Sent (${data.sent.count})` : "Sent" },
          { value: "matches", label: data.matches.length > 0 ? `Matches (${data.matches.length})` : "Matches" },
        ]}
      />

      {tab === "you" && data.tier === "FREE" ? (
        data.count === 0 ? (
          <EmptyState className="wide:rounded-card wide:glass-card wide:py-24" icon={<HeartIcon />} title="No new likes yet." description="When someone likes you, they'll appear here." />
        ) : (
          <section aria-label="People who like you" className="flex flex-col gap-4">
            {freeSupers.count > 0 ? (
              <button type="button" onClick={() => setLockOpen(true)} className="flex items-center gap-3 rounded-3xl glass-card p-3.5 text-left ring-1 ring-sand/60 pressable" data-testid="free-super-like">
                <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-sand text-on-sand"><StarIcon size={20} filled strokeWidth={0} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-text">{freeSuperTitle(freeSupers.count)}</span>
                  {freeSupers.withMessage > 0 ? <span className="block text-caption text-text-secondary">{freeSuperMessageLine(freeSupers.count, freeSupers.withMessage)}</span> : null}
                </span>
                <LockIcon size={16} className="shrink-0 text-text-secondary" aria-hidden="true" />
              </button>
            ) : null}
            {/* One locked tile per like, drawn from no data about anyone: the count is all the server sent. */}
            <div className="grid grid-cols-3 gap-2.5 wide:grid-cols-4 wide:gap-4" aria-hidden="true">
              {Array.from({ length: Math.min(data.count, LOCKED_TILE_CAP) }, (_, i) =>
                // Super Likes are listed first by the server, so the first `count` tiles are the starred ones.
                i < freeSupers.count ? (
                  <div key={i} className="relative">
                    <LockedPhoto blurhash={LOCKED_TILE_HASHES[i % LOCKED_TILE_HASHES.length]!} compact className="aspect-[3/4] rounded-2xl" />
                    <SuperRing />
                    <SuperLikeBadge className="absolute left-1.5 top-1.5" label="Super" />
                  </div>
                ) : (
                  <LockedPhoto key={i} blurhash={LOCKED_TILE_HASHES[i % LOCKED_TILE_HASHES.length]!} compact className="aspect-[3/4] rounded-2xl" />
                ),
              )}
            </div>
            <div className="flex flex-col items-center gap-3 rounded-3xl glass-card p-4 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-aqua-soft text-accent" aria-hidden="true"><LockIcon size={22} /></span>
              <div>
                {/* The real count from the shared eligibility rule; this branch only renders when it is at least one. */}
                <h2 className="text-h4 text-text">{data.count === 1 ? "Someone likes you ❤️" : `${data.count} people like you ❤️`}</h2>
                <p className="mt-1 text-caption text-text-secondary">See who&apos;s interested in you with MelloCrush Plus.</p>
                <div className="mt-1.5"><PlusTag size="sm" label="Plus feature" /></div>
              </div>
              {/* Named after what is locked, not after upgrading: this opens the explainer, and only the one CTA
                  inside it leads to Membership. */}
              <Button variant="plus" size="md" onClick={() => setLockOpen(true)}>See who likes you</Button>
            </div>
          </section>
        )
      ) : null}

      {tab === "you" && data.tier === "PLUS" ? (
        cards.length === 0 ? (
          <EmptyState className="wide:rounded-card wide:glass-card wide:py-24" icon={<HeartIcon />} title="No new likes yet." description="When someone likes you, they'll appear here." />
        ) : (
          <ul className="grid grid-cols-2 gap-2.5 desktop:grid-cols-3 wide:grid-cols-4 wide:gap-4" aria-label="People who like you">
            {cards.map((c) => {
              const superLike = plusSupers[c.handle];
              return (
                <li key={c.handle} className="relative aspect-[3/4]">
                  <button
                    type="button"
                    onClick={() => setOpen(c)}
                    className="absolute inset-0 overflow-hidden rounded-2xl border-0 bg-transparent p-0 text-left pressable"
                    aria-label={superLike ? `${c.name} Super Liked you${superLike.message ? " and sent a message" : ""}. Open their profile` : `Open ${c.name}'s profile`}
                  >
                    <ProfileCard profile={c} variant="tile" fill />
                  </button>
                  {superLike ? <SuperRing /> : null}
                  {superLike ? <SuperLikeBadge className="pointer-events-none absolute left-2 top-2" /> : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {tab === "sent" ? (
        sentCards.length === 0 ? (
          <EmptyState className="wide:rounded-card wide:glass-card wide:py-24" icon={<HeartIcon />} title="No pending likes." description="People you like wait here until they like you back." actions={<Button size="md" onClick={() => router.push("/discover")}>Start swiping</Button>} />
        ) : (
          <section aria-label="People you liked" className="flex flex-col gap-3">
            <p className="text-caption text-text-secondary">You liked them. If they like you back, it&apos;s a match.</p>
            <ul className="grid grid-cols-2 gap-2.5 desktop:grid-cols-3 wide:grid-cols-4 wide:gap-4" aria-label="People you liked">
              {sentCards.map((c) => {
                const superLike = sentSupers[c.handle];
                return (
                  <li key={c.handle} className="relative aspect-[3/4]">
                    <button
                      type="button"
                      onClick={() => setOpenSent(c)}
                      className="absolute inset-0 overflow-hidden rounded-2xl border-0 bg-transparent p-0 text-left pressable"
                      aria-label={superLike ? `You Super Liked ${c.name}. Open their profile` : `Open ${c.name}'s profile`}
                    >
                      <ProfileCard profile={c} variant="tile" fill />
                    </button>
                    {superLike ? <SuperRing /> : null}
                    {superLike ? <SuperLikeBadge className="pointer-events-none absolute left-2 top-2" label="Super Liked" /> : null}
                  </li>
                );
              })}
            </ul>
            {data.sent.count > sentCards.length ? <p className="text-center text-caption text-text-secondary">Showing your {sentCards.length} most recent likes.</p> : null}
          </section>
        )
      ) : null}

      {tab === "matches" ? (
        data.matches.length === 0 ? (
          <EmptyState className="wide:rounded-card wide:glass-card wide:py-24" icon={<HeartIcon />} title="Your next match could be one swipe away." actions={<Button size="md" onClick={() => router.push("/discover")}>Start swiping</Button>} />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-3xl glass-card wide:grid wide:grid-cols-3 wide:gap-4 wide:divide-y-0 wide:rounded-none wide:bg-transparent wide:shadow-none wide:backdrop-blur-none" aria-label="Your matches">
            {data.matches.map((m) => (
              <li key={m.handle} className="flex items-center gap-3 px-4 py-3 wide:rounded-2xl wide:glass-card wide:px-4 wide:py-3.5">
                <span className="size-12 shrink-0 overflow-hidden rounded-full bg-surface-muted" style={photoBackground(m.photo ? { url: m.photo.url, key: m.photo.demoKey, blurhash: m.photo.blurhash } : null, 160, "thumb")} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-body font-medium text-text"><span className="truncate">{m.name}</span>{m.verified ? <VerifiedBadge size={14} className="shrink-0" /> : null}</div>
                  <div className="text-caption text-text-secondary">Matched</div>
                </div>
                {m.conversationId ? <Link href={`/chats/${m.conversationId}`} className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-caption font-medium text-on-primary pressable">Say hello</Link> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {open ? (
        <FullProfile
          profile={open}
          onClose={() => setOpen(null)}
          onPass={() => void act(open, "pass")}
          onLike={() => void act(open, "like")}
          note={plusSupers[open.handle] ? <SuperLikeNote label={`${open.name} Super Liked you`} message={plusSupers[open.handle]!.message} /> : null}
        />
      ) : null}
      {/* No actions on a sent like: they already have your like, and withdrawing one is not a feature. Nor is editing
          a Super Like's message, or knowing whether it was seen. */}
      {openSent ? (
        <FullProfile
          profile={openSent}
          onClose={() => setOpenSent(null)}
          note={sentSupers[openSent.handle] ? <SuperLikeNote label={`You Super Liked ${openSent.name}`} message={sentSupers[openSent.handle]!.message} /> : null}
        />
      ) : null}
      <MatchOverlay open={match != null} name={match?.name ?? ""} theirPhoto={match?.photo ?? null} myPhoto={myPhoto} onSayHello={() => { const id = match?.conversationId; setMatch(null); router.push(id ? `/chats/${id}` : "/chats"); }} onKeepSwiping={() => setMatch(null)} />
      <PlusLockSheet open={lockOpen} onClose={() => setLockOpen(false)} feature="See who likes you" description="Plus shows who liked you, so you can like them back." surface={source} />
    </>
  );
}

/** The gold edge on a Super Like tile. Drawn inside the tile, over it, so the grid's edge can never clip it. */
function SuperRing() {
  return <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-inset ring-sand" />;
}

/** Free Likes You: that Super Likes exist, and how many — nothing about whose they are or what they say. */
function freeSuperTitle(count: number): string {
  return count === 1 ? "⭐ Someone Super Liked you" : `⭐ ${count} people Super Liked you`;
}

function freeSuperMessageLine(count: number, withMessage: number): string {
  if (count === 1) return "They sent you a message";
  if (withMessage >= count) return "They each sent you a message";
  return withMessage === 1 ? "One of them sent you a message" : `${withMessage} of them sent you a message`;
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { likeCard, passCard, type ActionFailure } from "@/actions/discovery";
import type { LikeOutcome } from "@/server/discovery/deck";
import type { PhotoRef } from "@/lib/photos";
import { photoBackground } from "@/lib/photos";
import type { LikesYouPageDto } from "@/server/likes/likes-page";
import { FullProfile } from "@/components/features/discovery/full-profile";
import { MatchOverlay } from "@/components/features/discovery/match-overlay";
import { ProfileCard } from "@/components/features/discovery/profile-card";
import { toDeckCard, type DeckCard } from "@/components/features/discovery/types";
import { PlusTag } from "@/components/ui/badge";
import { BlurhashCanvas } from "@/components/ui/blurhash";
import { Button } from "@/components/ui/button";
import { HeartIcon, LockIcon, VerifiedBadge } from "@/components/ui/icons";
import { PlusLockSheet } from "@/components/ui/plus-lock";
import { EmptyState } from "@/components/ui/states";
import { SegmentedControl } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { usePlusPromptView } from "@/components/features/analytics/plus-track";

/*
 * Likes tab (docs/ARCHITECTURE.md §12.5). Free: the count and anonymised blurhash tiles behind a lock, with one way
 * to Membership; the server sent no names, photos or handles, so there is nothing here to un-blur. Plus: the real
 * cards, opening to the full profile with Like back / Pass; a mutual like shows the match screen. Matches: the
 * viewer's active matches with a way into each chat.
 */
type Tab = "you" | "matches";

export function LikesClient({ initial, initialTab, myPhoto }: { initial: LikesYouPageDto; initialTab: Tab; myPhoto: PhotoRef | null }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState(initial);
  const [cards, setCards] = useState<DeckCard[]>(() => (initial.cards ?? []).map(toDeckCard));
  const [open, setOpen] = useState<DeckCard | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<{ name: string; photo: PhotoRef | null; conversationId: string | null } | null>(null);

  // Funnel (§12.19): the Free "N people like you" card is on screen. Never fires at zero or for Plus.
  usePlusPromptView("likes_you", tab === "you" && data.tier === "FREE" && data.count > 0);

  const remove = (handle: string) => {
    setCards((prev) => prev.filter((c) => c.handle !== handle));
    setData((prev) => ({ ...prev, count: Math.max(0, prev.count - 1) }) as LikesYouPageDto);
  };

  const act = async (card: DeckCard, kind: "like" | "pass") => {
    if (busy) return;
    setBusy(true);
    const fail = (): ActionFailure => ({ ok: false, code: "ERROR", message: "", serverNow: "" });
    const result: ({ ok: true } & Partial<LikeOutcome>) | ActionFailure = kind === "like" ? await likeCard({ handle: card.handle }).catch(fail) : await passCard({ handle: card.handle }).catch(fail);
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
      <SegmentedControl label="Likes sections" className="mb-4 mt-2" value={tab} onChange={setTab} items={[{ value: "you", label: data.count > 0 ? `Likes You (${data.count})` : "Likes You" }, { value: "matches", label: data.matches.length > 0 ? `Matches (${data.matches.length})` : "Matches" }]} />

      {tab === "you" && data.tier === "FREE" ? (
        data.count === 0 ? (
          <EmptyState className="wide:rounded-card wide:glass-card wide:py-24" icon={<HeartIcon />} title="No new likes yet." description="When someone likes you, they'll appear here." />
        ) : (
          <section aria-label="People who like you" className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2.5 wide:grid-cols-4 wide:gap-4" aria-hidden="true">
              {data.placeholders!.map((p, i) => (
                <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-2xl">
                  <BlurhashCanvas hash={p.blurhash} />
                  {p.verified ? <VerifiedBadge size={16} className="absolute right-2 top-2" /> : null}
                </div>
              ))}
            </div>
            <div className="flex flex-col items-center gap-3 rounded-3xl glass-card p-4 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-aqua-soft text-accent" aria-hidden="true"><LockIcon size={22} /></span>
              <div>
                {/* The real count from the shared eligibility rule; this branch only renders when it is at least one. */}
                <h2 className="text-h4 text-text">{data.count === 1 ? "Someone likes you" : `${data.count} people like you`}</h2>
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
            {cards.map((c) => (
              <li key={c.handle} className="relative aspect-[3/4]">
                <button type="button" onClick={() => setOpen(c)} className="absolute inset-0 overflow-hidden rounded-2xl border-0 bg-transparent p-0 text-left pressable" aria-label={`Open ${c.name}'s profile`}>
                  <ProfileCard profile={c} variant="tile" fill />
                </button>
              </li>
            ))}
          </ul>
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

      {open ? <FullProfile profile={open} onClose={() => setOpen(null)} onPass={() => void act(open, "pass")} onLike={() => void act(open, "like")} /> : null}
      <MatchOverlay open={match != null} name={match?.name ?? ""} theirPhoto={match?.photo ?? null} myPhoto={myPhoto} onSayHello={() => { const id = match?.conversationId; setMatch(null); router.push(id ? `/chats/${id}` : "/chats"); }} onKeepSwiping={() => setMatch(null)} />
      <PlusLockSheet open={lockOpen} onClose={() => setLockOpen(false)} feature="See who likes you" description="Plus shows who liked you, so you can like them back." surface="likes_you" />
    </>
  );
}

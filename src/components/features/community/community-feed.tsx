"use client";

import { useEffect, useRef, useState } from "react";
import { loadFeed, reactToPost } from "@/actions/community";
import { IconButton, Spinner } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { PeopleIcon, PlusIcon } from "@/components/ui/icons";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PillTabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { AppScreen, ScrollArea } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import type { CommunityPostDto } from "@/server/community/dto";
import type { FeedPage, FeedTab } from "@/server/community/feed";
import { call } from "./call";
import { ComposeSheet } from "./compose-sheet";
import { ContentMenu, type ContentTarget } from "./content-menu";
import { PostCard } from "./post-card";
import { useProfileOverlay } from "./use-profile-overlay";

/*
 * Community feed (prototype screen: header, three pill tabs, post cards, FAB). Server-driven: the first "For You"
 * page is rendered by the route, later pages and the "New" tab load through server actions with an opaque
 * cursor. Ranking is chronological (docs §14) — no engagement scoring. "Following" has no backing feature in
 * the product and shows an explanatory state. Like taps are optimistic and reconciled with the server's count.
 */

type TabKey = "foryou" | "following" | "new";
const TAB_TO_FEED: Record<Exclude<TabKey, "following">, FeedTab> = { foryou: "FOR_YOU", new: "NEW" };

interface TabState {
  posts: CommunityPostDto[];
  nextCursor: string | null;
  loaded: boolean;
  status: "idle" | "loading" | "error";
  now: string;
}

const fresh = (now: string): TabState => ({ posts: [], nextCursor: null, loaded: false, status: "idle", now });

export interface CommunityFeedProps {
  /** First page of For You, or null when the server could not load it (the client offers a retry). */
  initial: FeedPage | null;
  serverNow: string;
  island: string | null;
  canPost: boolean;
}

export function CommunityFeed({ initial, serverNow, island, canPost }: CommunityFeedProps) {
  const toast = useToast();
  const profile = useProfileOverlay();
  const [tab, setTab] = useState<TabKey>("foryou");
  const [tabs, setTabs] = useState<Record<FeedTab, TabState>>({
    FOR_YOU: initial ? { posts: initial.posts, nextCursor: initial.nextCursor, loaded: true, status: "idle", now: initial.serverNow } : { ...fresh(serverNow), status: "error" },
    NEW: fresh(serverNow),
  });
  const [composeOpen, setComposeOpen] = useState(false);
  const [menuTarget, setMenuTarget] = useState<ContentTarget | null>(null);
  const inFlight = useRef<Set<string>>(new Set());
  const pendingLikes = useRef<Set<string>>(new Set());
  const sentinel = useRef<HTMLDivElement>(null);

  const patch = (feedTab: FeedTab, fn: (s: TabState) => TabState) => setTabs((prev) => ({ ...prev, [feedTab]: fn(prev[feedTab]) }));
  const patchPost = (id: string, fn: (p: CommunityPostDto) => CommunityPostDto) =>
    setTabs((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(prev) as FeedTab[]) next[k] = { ...prev[k], posts: prev[k].posts.map((p) => (p.id === id ? fn(p) : p)) };
      return next;
    });
  const dropPosts = (predicate: (p: CommunityPostDto) => boolean) =>
    setTabs((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(prev) as FeedTab[]) next[k] = { ...prev[k], posts: prev[k].posts.filter((p) => !predicate(p)) };
      return next;
    });

  const load = async (feedTab: FeedTab, mode: "first" | "more") => {
    const key = `${feedTab}:${mode}`;
    if (inFlight.current.has(key)) return;
    const cursor = mode === "more" ? tabs[feedTab].nextCursor : null;
    if (mode === "more" && !cursor) return;
    inFlight.current.add(key);
    patch(feedTab, (s) => ({ ...s, status: "loading" }));
    const r = await call(() => loadFeed({ tab: feedTab, cursor }));
    inFlight.current.delete(key);
    if (!r.ok) {
      patch(feedTab, (s) => ({ ...s, status: "error" }));
      return;
    }
    patch(feedTab, (s) => {
      const seen = new Set(mode === "more" ? s.posts.map((p) => p.id) : []);
      const incoming = r.posts.filter((p) => !seen.has(p.id));
      return { posts: mode === "more" ? [...s.posts, ...incoming] : incoming, nextCursor: r.nextCursor, loaded: true, status: "idle", now: r.serverNow };
    });
  };

  const onTab = (next: TabKey) => {
    setTab(next);
    if (next !== "following" && !tabs[TAB_TO_FEED[next]].loaded && tabs[TAB_TO_FEED[next]].status !== "loading") void load(TAB_TO_FEED[next], "first");
  };

  const feedTab: FeedTab | null = tab === "following" ? null : TAB_TO_FEED[tab];
  const state = feedTab ? tabs[feedTab] : null;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !feedTab || !state || state.status !== "idle" || !state.nextCursor) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load(feedTab, "more");
    }, { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load closes over the latest tabs; re-armed on cursor/status change
  }, [feedTab, state?.status, state?.nextCursor]);

  const toggleLike = async (post: CommunityPostDto) => {
    if (pendingLikes.current.has(post.id)) return;
    pendingLikes.current.add(post.id);
    const liked = !post.likedByMe;
    const before = { likedByMe: post.likedByMe, likeCount: post.likeCount };
    patchPost(post.id, (p) => ({ ...p, likedByMe: liked, likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)) }));
    const r = await call(() => reactToPost({ postId: post.id, liked }));
    pendingLikes.current.delete(post.id);
    if (!r.ok) {
      patchPost(post.id, (p) => ({ ...p, ...before }));
      if (r.code === "NOT_FOUND") dropPosts((p) => p.id === post.id);
      toast.show(r.message);
      return;
    }
    patchPost(post.id, (p) => ({ ...p, likedByMe: r.liked, likeCount: r.likeCount }));
  };

  const onPosted = (post: CommunityPostDto) => {
    setComposeOpen(false);
    setTabs((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(prev) as FeedTab[]) {
        if (!prev[k].loaded) continue;
        next[k] = { ...prev[k], posts: [post, ...prev[k].posts.filter((p) => p.id !== post.id)] };
      }
      return next;
    });
    if (tab === "following") setTab("foryou");
    toast.show(post.photoUnderReview ? "Posted. Your photo shows to others once it's reviewed." : "Posted to Community", { durationMs: post.photoUnderReview ? 3200 : 1800 });
  };

  const openMenu = (post: CommunityPostDto) => setMenuTarget({ kind: "post", id: post.id, authorName: post.author.name, authorHandle: post.author.handle, isMine: post.isMine });

  const emptyFor = (t: FeedTab) =>
    t === "NEW" ? (
      <EmptyState icon={<PeopleIcon />} title="Nothing new in the last 24 hours." description="For You has everything that's been posted so far — or start something." />
    ) : (
      <EmptyState icon={<PeopleIcon />} title="Nothing here yet." description="Be the first to post something." />
    );

  return (
    <AppScreen aria-label="Community" className="relative wide:mx-auto wide:w-full wide:max-w-[var(--feed-wide)]">
      <TabHeader title="Community" />
      <PillTabs
        label="Community feeds"
        className="mb-2.5 mt-1.5"
        value={tab}
        onChange={onTab}
        items={[
          { value: "foryou", label: "For You" },
          { value: "following", label: "Following" },
          { value: "new", label: "New" },
        ]}
      />
      <ScrollArea className="flex flex-col gap-2.5" aria-live="polite">
        {tab === "following" || !feedTab || !state ? (
          <EmptyState icon={<PeopleIcon />} title="Nothing to follow yet." description="Following isn't part of Community yet. Posts from everyone appear in For You." />
        ) : state.status === "error" && state.posts.length === 0 ? (
          <ErrorState title="Community couldn't load" description="Check your connection and try again." onRetry={() => void load(feedTab, "first")} />
        ) : state.status === "loading" && state.posts.length === 0 ? (
          <div className="flex justify-center py-8" role="status" aria-label="Loading posts">
            <Spinner size={22} className="text-primary" />
          </div>
        ) : state.loaded && state.posts.length === 0 ? (
          emptyFor(feedTab)
        ) : (
          <>
            {state.posts.map((post) => (
              <PostCard key={post.id} post={post} now={state.now} onToggleLike={(p) => void toggleLike(p)} onOpenAuthor={(a) => void profile.open(a)} onOpenMenu={openMenu} />
            ))}
            <div ref={sentinel} aria-hidden="true" className="h-px shrink-0" />
            {state.status === "loading" ? (
              <div className="flex justify-center py-3" role="status" aria-label="Loading more posts">
                <Spinner size={20} className="text-primary" />
              </div>
            ) : state.status === "error" ? (
              <div className="flex flex-col items-center gap-2 py-3 text-center" role="alert">
                <p className="text-body-sm text-text-secondary">Couldn&apos;t load more posts.</p>
                <Button variant="secondary" size="sm" onClick={() => void load(feedTab, "more")}>Try again</Button>
              </div>
            ) : state.nextCursor ? (
              <div className="flex justify-center py-1">
                <Button variant="secondary" size="sm" onClick={() => void load(feedTab, "more")}>Load more</Button>
              </div>
            ) : (
              <p className="py-3 text-center text-caption text-text-muted">You&apos;re all caught up.</p>
            )}
          </>
        )}
      </ScrollArea>

      {canPost ? (
        <IconButton
          aria-label="Create post"
          variant="ocean"
          round
          size={54}
          onClick={() => setComposeOpen(true)}
          className="absolute right-5 bottom-[calc(88px+var(--safe-bottom))] z-[5] shadow-lg pressable-round desktop:bottom-6"
        >
          <PlusIcon size={26} strokeWidth={2.4} />
        </IconButton>
      ) : null}

      <ComposeSheet open={composeOpen} onClose={() => setComposeOpen(false)} island={island} onPosted={onPosted} />
      <ContentMenu
        target={menuTarget}
        onClose={() => setMenuTarget(null)}
        onDeleted={(t) => dropPosts((p) => p.id === t.id)}
        onBlocked={(t) => dropPosts((p) => p.author.handle === t.authorHandle)}
      />
      {profile.element}
    </AppScreen>
  );
}

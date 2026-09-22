"use client";

import { useEffect, useRef, useState } from "react";
import { loadCommunityDiscover, loadFeed, loadPostReactorList, reactToPost, setPostEmoji } from "@/actions/community";
import type { ReactionKey } from "@/lib/reactions";
import { Avatar } from "@/components/ui/avatar";
import { ReactionPicker, ReactorSheet, type ReactorRow } from "@/components/ui/reactions";
import { IconButton, Spinner } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { ErrorState } from "@/components/ui/states";
import { PillTabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { AppScreen, ScrollArea } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import type { CommunityDiscoverDto } from "@/server/community/discover";
import type { CommunityAuthorDto, CommunityPostDto, CommunityPostKind } from "@/server/community/dto";
import type { FeedPage, FeedTab } from "@/server/community/feed";
import type { PollDto } from "@/server/community/polls";
import type { TopicKey } from "@/server/community/topics";
import { call } from "./call";
import { ComposeSheet } from "./compose-sheet";
import { ContentMenu, type ContentTarget } from "./content-menu";
import { CreateMenu } from "./create-menu";
import { FeedFiller } from "./feed-filler";
import { PopularToday } from "./popular-today";
import { authorPhotoRef, PostCard } from "./post-card";
import { QuickPost } from "./quick-post";
import { TopicChips } from "./topic-chips";
import { useProfileOverlay } from "./use-profile-overlay";

/*
 * Community feed: header, three pill tabs, a topic row, the quick-post prompt, post cards and the FAB.
 *
 * Server-driven. The first "For You" page is rendered by the route; everything after it loads through server
 * actions with an opaque cursor. Ranking stays chronological (docs §14) — the only thing that reorders anything is
 * the Popular today module, which is a separate, explicitly-labelled list rather than a score applied to the feed.
 * All three tabs are now real feeds: Following reads the viewer's own follow rows.
 *
 * Two layout rules the brief is specific about:
 *   - Popular today is inserted BETWEEN posts (after the third) when the feed is long enough to have a middle.
 *   - A short feed is never a wall of white ending in "You're all caught up." Below `SHORT_FEED` posts the filler
 *     takes the remaining space with real discussions, real people and editorial prompts (see feed-filler.tsx).
 */

const TABS: { value: FeedTab; label: string }[] = [
  { value: "FOR_YOU", label: "For You" },
  { value: "FOLLOWING", label: "Following" },
  { value: "NEW", label: "New" },
];

/** Where Popular today sits, and the feed length that earns it a middle to sit in. */
const MODULE_AFTER = 3;
const MODULE_MIN_POSTS = 5;
/** Below this many posts the screen is padded out with the filler instead of ending in empty space. */
const SHORT_FEED = 4;

interface TabState {
  posts: CommunityPostDto[];
  nextCursor: string | null;
  loaded: boolean;
  status: "idle" | "loading" | "error";
  now: string;
}

const fresh = (now: string): TabState => ({ posts: [], nextCursor: null, loaded: false, status: "idle", now });
const allFresh = (now: string): Record<FeedTab, TabState> => ({ FOR_YOU: fresh(now), FOLLOWING: fresh(now), NEW: fresh(now) });

export interface CommunityFeedProps {
  /** First page of For You, or null when the server could not load it (the client offers a retry). */
  initial: FeedPage | null;
  serverNow: string;
  island: string | null;
  canPost: boolean;
  /** The viewer's own avatar and name, for the quick-post row. */
  me: CommunityAuthorDto | null;
}

export function CommunityFeed({ initial, serverNow, island, canPost, me }: CommunityFeedProps) {
  const toast = useToast();
  const profile = useProfileOverlay();
  const [tab, setTab] = useState<FeedTab>("FOR_YOU");
  const [topic, setTopic] = useState<TopicKey | null>(null);
  const [tabs, setTabs] = useState<Record<FeedTab, TabState>>(() => ({
    ...allFresh(serverNow),
    FOR_YOU: initial ? { posts: initial.posts, nextCursor: initial.nextCursor, loaded: true, status: "idle", now: initial.serverNow } : { ...fresh(serverNow), status: "error" },
  }));
  const [discover, setDiscover] = useState<CommunityDiscoverDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [composeKind, setComposeKind] = useState<CommunityPostKind | null>(null);
  const [menuTarget, setMenuTarget] = useState<ContentTarget | null>(null);
  const inFlight = useRef<Set<string>>(new Set());
  const pendingLikes = useRef<Set<string>>(new Set());
  const [picker, setPicker] = useState<{ post: CommunityPostDto; point: { x: number; y: number } } | null>(null);
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const [reactors, setReactors] = useState<ReactorRow[]>([]);
  const [reactorsLoading, setReactorsLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  /*
   * Bumped whenever the chip row changes. A request that was already in the air when it changed is answering a
   * question nobody is asking any more, so it is dropped on arrival rather than pasted over the new filter's
   * results — the bug this prevents is the old topic's posts appearing under the new chip for one frame.
   */
  const generation = useRef(0);

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

  const load = async (feedTab: FeedTab, mode: "first" | "more", forTopic: TopicKey | null) => {
    const key = `${feedTab}:${mode}`;
    if (inFlight.current.has(key)) return;
    const cursor = mode === "more" ? tabs[feedTab].nextCursor : null;
    if (mode === "more" && !cursor) return;
    const gen = generation.current;
    inFlight.current.add(key);
    patch(feedTab, (s) => ({ ...s, status: "loading" }));
    const r = await call(() => loadFeed({ tab: feedTab, topic: forTopic, cursor }));
    inFlight.current.delete(key);
    if (generation.current !== gen) return;
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

  const onTab = (next: FeedTab) => {
    setTab(next);
    if (!tabs[next].loaded && tabs[next].status !== "loading") void load(next, "first", topic);
  };

  const onTopic = (next: TopicKey | null) => {
    if (next === topic) return;
    generation.current += 1;
    inFlight.current.clear();
    setTopic(next);
    setTabs(allFresh(serverNow));
    void load(tab, "first", next);
  };

  const state = tabs[tab];

  // The side modules are loaded once, separately from the feed, so paging never pays for three aggregate queries.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await call(() => loadCommunityDiscover());
      if (!cancelled && r.ok) setDiscover({ popular: r.popular, suggestions: r.suggestions, activeTopics: r.activeTopics });
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || state.status !== "idle" || !state.nextCursor) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load(tab, "more", topic);
    }, { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load closes over the latest tabs; re-armed on cursor/status change
  }, [tab, topic, state.status, state.nextCursor]);

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
    patchPost(post.id, (p) => ({ ...p, likedByMe: r.liked, likeCount: r.likeCount, reactions: r.reactions }));
  };

  /** The picker's choice, or a pill tapped in the grouped row. The server's counts win over the optimistic ones. */
  const setReaction = async (post: CommunityPostDto, emoji: ReactionKey | null) => {
    setPicker(null);
    const r = await call(() => setPostEmoji({ postId: post.id, emoji }));
    if (!r.ok) {
      if (r.code === "NOT_FOUND") dropPosts((p) => p.id === post.id);
      else toast.show(r.message);
      return;
    }
    patchPost(post.id, (p) => ({ ...p, likeCount: r.likeCount, likedByMe: r.reactions.mine !== null, reactions: r.reactions }));
  };

  const openReactors = async (post: CommunityPostDto) => {
    setReactorsOpen(true);
    setReactors([]);
    setReactorsLoading(true);
    const r = await call(() => loadPostReactorList({ postId: post.id }));
    setReactorsLoading(false);
    if (r.ok) {
      setReactors(r.reactors.map((x) => ({
        emoji: x.emoji,
        name: x.isMe ? "You" : x.author.name,
        isMe: x.isMe,
        avatar: <Avatar name="" aria-hidden="true" photo={authorPhotoRef(x.author)} size={32} />,
      })));
    }
  };

  const onPollVoted = (postId: string, poll: PollDto) => patchPost(postId, (p) => ({ ...p, poll }));

  /** Follow state lives on every copy of that author, in the feed and in the suggestions list alike. */
  const onFollowChanged = (handle: string, following: boolean) => {
    if (!handle) return;
    setTabs((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(prev) as FeedTab[]) {
        next[k] = { ...prev[k], posts: prev[k].posts.map((p) => (p.author.handle === handle ? { ...p, author: { ...p.author, followed: following } } : p)) };
      }
      return next;
    });
    setDiscover((prev) => (prev ? { ...prev, suggestions: prev.suggestions.map((s) => (s.author.handle === handle ? { ...s, author: { ...s.author, followed: following } } : s)) } : prev));
    // A new follow changes what Following holds, so make it fetch again rather than show a stale page.
    patch("FOLLOWING", (s) => ({ ...s, loaded: false }));
  };

  const onPosted = (post: CommunityPostDto) => {
    setComposeKind(null);
    setTabs((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(prev) as FeedTab[]) {
        if (!prev[k].loaded) continue;
        // A post only belongs at the top of a feed it would actually match.
        if (k === "FOLLOWING") continue;
        if (topic && post.topic !== topic) continue;
        next[k] = { ...prev[k], posts: [post, ...prev[k].posts.filter((p) => p.id !== post.id)] };
      }
      return next;
    });
    if (tab === "FOLLOWING") setTab("FOR_YOU");
    // Posted under a different chip from the one being viewed: follow the post rather than leave the author
    // staring at a feed that appears not to contain what they just wrote.
    if (topic && post.topic !== topic) onTopic(post.topic);
    toast.show(post.photoUnderReview ? "Posted. Your photo shows to others once it's reviewed." : "Posted to Community", { durationMs: post.photoUnderReview ? 3200 : 1800 });
  };

  const compose = (kind: CommunityPostKind) => {
    setCreateOpen(false);
    setComposeKind(kind);
  };

  const openMenu = (post: CommunityPostDto) =>
    setMenuTarget({ kind: "post", id: post.id, authorName: post.isAnonymous ? "this person" : post.author.name, authorHandle: post.author.handle, isMine: post.isMine });

  const emptyLine =
    tab === "FOLLOWING"
      ? "You're not following anyone yet. Follow someone from their post and their posts show up here."
      : tab === "NEW"
        ? "Nothing new in the last 24 hours."
        : topic
          ? "Nothing under this topic yet."
          : "Nothing here yet.";

  const showFiller = state.loaded && state.posts.length < SHORT_FEED && !state.nextCursor;
  const showModule = state.posts.length >= MODULE_MIN_POSTS && (discover?.popular.length ?? 0) > 0;

  return (
    <AppScreen aria-label="Community" className="relative wide:mx-auto wide:w-full wide:max-w-[var(--feed-wide)]">
      <TabHeader title="Community" />
      <PillTabs label="Community feeds" className="mb-1 mt-1" value={tab} onChange={onTab} items={TABS} />
      <TopicChips value={topic} onChange={onTopic} className="mb-1.5" />
      <ScrollArea className="flex flex-col gap-2.5" aria-live="polite">
        {canPost && me ? <QuickPost photo={me.photo ? { url: me.photo.url, key: me.photo.demoKey, blurhash: me.photo.blurhash } : null} name={me.name} onCompose={compose} /> : null}

        {state.status === "error" && state.posts.length === 0 ? (
          <ErrorState title="Community couldn't load" description="Check your connection and try again." onRetry={() => void load(tab, "first", topic)} />
        ) : state.status === "loading" && state.posts.length === 0 ? (
          <div className="flex justify-center py-8" role="status" aria-label="Loading posts">
            <Spinner size={22} className="text-primary" />
          </div>
        ) : (
          <>
            {state.posts.map((post, index) => (
              <div key={post.id} className="contents">
                <PostCard
                  post={post}
                  now={state.now}
                  onToggleLike={(p) => void toggleLike(p)}
                  onReactionPicker={(p, point) => setPicker({ post: p, point })}
                  onSetReaction={(p, emoji) => void setReaction(p, emoji)}
                  onInspectReactions={(p) => void openReactors(p)}
                  onOpenAuthor={(a) => void profile.open(a)}
                  onOpenMenu={openMenu}
                  onPollVoted={onPollVoted}
                  onFollowChanged={onFollowChanged}
                />
                {showModule && index === MODULE_AFTER - 1 ? <PopularToday posts={discover?.popular ?? []} /> : null}
              </div>
            ))}

            {showFiller ? (
              <>
                {state.posts.length === 0 ? <p className="px-1 pt-1 text-body-sm text-text-secondary">{emptyLine}</p> : null}
                <FeedFiller
                  discover={discover}
                  topic={topic}
                  postCount={state.posts.length}
                  canPost={canPost}
                  onCompose={compose}
                  onPickTopic={onTopic}
                  onOpenAuthor={(a) => void profile.open(a)}
                  onFollowChanged={onFollowChanged}
                />
              </>
            ) : null}

            <div ref={sentinel} aria-hidden="true" className="h-px shrink-0" />
            {state.status === "loading" ? (
              <div className="flex justify-center py-3" role="status" aria-label="Loading more posts">
                <Spinner size={20} className="text-primary" />
              </div>
            ) : state.status === "error" ? (
              <div className="flex flex-col items-center gap-2 py-3 text-center" role="alert">
                <p className="text-body-sm text-text-secondary">Couldn&apos;t load more posts.</p>
                <Button variant="secondary" size="sm" onClick={() => void load(tab, "more", topic)}>Try again</Button>
              </div>
            ) : state.nextCursor ? (
              <div className="flex justify-center py-1">
                <Button variant="secondary" size="sm" onClick={() => void load(tab, "more", topic)}>Load more</Button>
              </div>
            ) : state.posts.length > 0 && !showFiller ? (
              <p className="py-3 text-center text-caption text-text-muted">You&apos;re all caught up.</p>
            ) : null}
          </>
        )}
      </ScrollArea>

      {canPost ? (
        <IconButton
          aria-label="Create post"
          variant="ocean"
          round
          size={54}
          onClick={() => setCreateOpen(true)}
          className="absolute right-5 bottom-[calc(88px+var(--safe-bottom))] z-[5] shadow-lg pressable-round desktop:bottom-6"
        >
          <PlusIcon size={26} strokeWidth={2.4} />
        </IconButton>
      ) : null}

      <CreateMenu open={createOpen} onClose={() => setCreateOpen(false)} onPick={compose} />
      <ComposeSheet
        open={composeKind !== null}
        kind={composeKind ?? "TEXT"}
        onClose={() => setComposeKind(null)}
        onChangeKind={() => { setComposeKind(null); setCreateOpen(true); }}
        island={island}
        onPosted={onPosted}
      />
      <ContentMenu
        target={menuTarget}
        onClose={() => setMenuTarget(null)}
        onDeleted={(t) => dropPosts((p) => p.id === t.id)}
        onBlocked={(t) => {
          // An anonymous author has no handle, so there is nothing to match on — and matching on "" would sweep
          // away every anonymous post at once, which would read as "they were all the same person". Refetch.
          if (t.authorHandle) dropPosts((p) => p.author.handle === t.authorHandle);
          else { generation.current += 1; setTabs(allFresh(serverNow)); void load(tab, "first", topic); }
        }}
      />
      <ReactionPicker
        at={picker?.point ?? null}
        current={picker?.post.reactions.mine ?? null}
        onPick={(emoji) => { if (picker) void setReaction(picker.post, emoji); }}
        onClose={() => setPicker(null)}
        label="Choose a reaction"
      />
      <ReactorSheet open={reactorsOpen} onClose={() => setReactorsOpen(false)} rows={reactors} loading={reactorsLoading} />

      {profile.element}
    </AppScreen>
  );
}

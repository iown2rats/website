"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { loadComments, postComment, reactToPost } from "@/actions/community";
import { COMMUNITY } from "@/config/product";
import { cn } from "@/lib/cn";
import { shortRelativeTime } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Button, Spinner } from "@/components/ui/button";
import { ChevronLeftIcon, MoreIcon, VerifiedBadge } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { CommentsPage } from "@/server/community/comments";
import type { CommunityCommentDto, CommunityPostDto } from "@/server/community/dto";
import { call } from "./call";
import { ContentMenu, type ContentTarget } from "./content-menu";
import { authorPhotoRef, PostCard } from "./post-card";
import { PostUnavailable } from "./post-unavailable";
import { useProfileOverlay } from "./use-profile-overlay";

/*
 * Post thread: the post card, its flat comment list (oldest first, paginated) and a comment composer. The prototype
 * shows comment counts on cards but no thread screen; this view is the smallest addition that lets those counts
 * mean something (docs §14). Comments are optimistic and reconciled; deleted or blocked content leaves the list.
 */

type LocalComment = CommunityCommentDto & { pending?: boolean };

export interface PostDetailProps {
  initialPost: CommunityPostDto;
  initialComments: CommentsPage;
  serverNow: string;
}

export function PostDetail({ initialPost, initialComments, serverNow }: PostDetailProps) {
  const router = useRouter();
  const toast = useToast();
  const profile = useProfileOverlay();
  const [post, setPost] = useState<CommunityPostDto | null>(initialPost);
  const [comments, setComments] = useState<LocalComment[]>(initialComments.comments);
  const [nextCursor, setNextCursor] = useState<string | null>(initialComments.nextCursor);
  const [loadingMore, setLoadingMore] = useState<"idle" | "loading" | "error">("idle");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [menuTarget, setMenuTarget] = useState<ContentTarget | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const likePending = useRef(false);

  if (!post) return <PostUnavailable />;

  const gone = () => { setPost(null); };

  const toggleLike = async (p: CommunityPostDto) => {
    if (likePending.current) return;
    likePending.current = true;
    const liked = !p.likedByMe;
    const before = { likedByMe: p.likedByMe, likeCount: p.likeCount };
    setPost((cur) => cur && { ...cur, likedByMe: liked, likeCount: Math.max(0, cur.likeCount + (liked ? 1 : -1)) });
    const r = await call(() => reactToPost({ postId: p.id, liked }));
    likePending.current = false;
    if (!r.ok) {
      setPost((cur) => cur && { ...cur, ...before });
      if (r.code === "NOT_FOUND") return gone();
      toast.show(r.message);
      return;
    }
    setPost((cur) => cur && { ...cur, likedByMe: r.liked, likeCount: r.likeCount });
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore === "loading") return;
    setLoadingMore("loading");
    const r = await call(() => loadComments({ postId: post.id, cursor: nextCursor }));
    if (!r.ok) {
      if (r.code === "NOT_FOUND") return gone();
      setLoadingMore("error");
      return;
    }
    setComments((cur) => {
      const seen = new Set(cur.map((c) => c.id));
      return [...cur, ...r.comments.filter((c) => !seen.has(c.id))];
    });
    setNextCursor(r.nextCursor);
    setLoadingMore("idle");
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const tempId = `tmp-${crypto.randomUUID()}`;
    const optimistic: LocalComment = { id: tempId, body, createdAt: serverNow, author: { handle: "", name: "You", verified: false, location: null, photo: null, isMe: true }, isMine: true, pending: true };
    setComments((cur) => [...cur, optimistic]);
    setDraft("");
    const r = await call(() => postComment({ postId: post.id, body }));
    setSending(false);
    if (!r.ok) {
      setComments((cur) => cur.filter((c) => c.id !== tempId));
      setDraft(body);
      if (r.code === "NOT_FOUND") return gone();
      toast.show(r.message);
      return;
    }
    setComments((cur) => cur.map((c) => (c.id === tempId ? r.comment : c)));
    setPost((cur) => cur && { ...cur, commentCount: cur.commentCount + 1 });
  };

  const onDeleted = (t: ContentTarget) => {
    if (t.kind === "post") { router.replace("/community"); return; }
    setComments((cur) => cur.filter((c) => c.id !== t.id));
    setPost((cur) => cur && { ...cur, commentCount: Math.max(0, cur.commentCount - 1) });
  };
  const onBlocked = (t: ContentTarget) => {
    if (t.kind === "post" || t.authorHandle === post.author.handle) { router.replace("/community"); return; }
    setComments((cur) => cur.filter((c) => c.author.handle !== t.authorHandle));
  };

  // Header count: what this viewer can actually see once the thread is fully loaded (blocked authors' comments are
  // filtered server-side); the persisted public counter is used only while more pages remain.
  const visibleCount = nextCursor ? post.commentCount : comments.filter((c) => !c.pending).length;
  const commentMenu = (c: CommunityCommentDto) => setMenuTarget({ kind: "comment", id: c.id, authorName: c.author.name, authorHandle: c.author.handle, isMine: c.isMine });
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background animate-fade-in">
      <header className="flex shrink-0 items-center gap-2 px-1.5" style={{ height: "calc(var(--page-header-height) + var(--safe-top))", paddingTop: "var(--safe-top)" }}>
        <Link href="/community" aria-label="Back to Community" className="grid size-11 shrink-0 place-items-center rounded-md text-text hover:bg-surface-muted">
          <ChevronLeftIcon size={22} strokeWidth={2.2} />
        </Link>
        <h1 className="flex-1 truncate text-prompt text-text">Post</h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-hidden px-4 pb-4 pt-1">
        <PostCard
          post={post}
          now={serverNow}
          onToggleLike={(p) => void toggleLike(p)}
          onOpenAuthor={(a) => void profile.open(a)}
          onOpenMenu={(p) => setMenuTarget({ kind: "post", id: p.id, authorName: p.author.name, authorHandle: p.author.handle, isMine: p.isMine })}
          onComments={() => composer.current?.focus()}
        />

        <section aria-label="Comments" className="flex flex-col gap-1">
          <h2 className="px-1 pb-1 text-caption font-medium uppercase tracking-[.06em] text-text-secondary">
            {visibleCount === 0 ? "Comments" : `${visibleCount} ${visibleCount === 1 ? "comment" : "comments"}`}
          </h2>
          {comments.length === 0 ? (
            <p className="px-1 py-6 text-center text-body-sm text-text-secondary">No comments yet. Be the first to reply.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {comments.map((c) => (
                <li key={c.id} className={cn("flex gap-2.5 border-b border-border py-3 last:border-b-0", c.pending && "opacity-60")}>
                  <button type="button" onClick={() => void profile.open(c.author)} aria-label={c.isMine ? "Your profile" : `View ${c.author.name}'s profile`} className="shrink-0 self-start rounded-full border-0 bg-transparent p-0">
                    <Avatar name="" aria-hidden="true" photo={authorPhotoRef(c.author)} size={40} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.25 text-body-sm">
                      <span className="truncate font-medium text-text">{c.author.name}</span>
                      {c.author.verified ? <VerifiedBadge size={13} className="shrink-0" /> : null}
                      <span className="text-text-secondary">· {c.pending ? "sending" : shortRelativeTime(c.createdAt, new Date(serverNow))}</span>
                    </div>
                    <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-body leading-normal text-text">{c.body}</p>
                  </div>
                  {!c.pending ? (
                    <button type="button" onClick={() => commentMenu(c)} aria-label="Comment options" className="grid size-8 shrink-0 place-items-center self-start rounded-sm border-0 bg-transparent text-text-secondary hover:bg-surface-muted">
                      <MoreIcon size={16} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {loadingMore === "loading" ? (
            <div className="flex justify-center py-3" role="status" aria-label="Loading more comments"><Spinner size={20} className="text-primary" /></div>
          ) : loadingMore === "error" ? (
            <div className="flex flex-col items-center gap-2 py-3" role="alert">
              <p className="text-body-sm text-text-secondary">Couldn&apos;t load more comments.</p>
              <Button variant="secondary" size="md" onClick={() => void loadMore()}>Try again</Button>
            </div>
          ) : nextCursor ? (
            <div className="flex justify-center py-2"><Button variant="secondary" size="md" onClick={() => void loadMore()}>Show more comments</Button></div>
          ) : null}
        </section>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void send(); }}
        className="flex shrink-0 items-end gap-2.5 border-t border-border bg-surface px-3 pt-2.5"
        style={{ paddingBottom: "calc(12px + var(--safe-bottom))" }}
      >
        <label htmlFor="comment-composer" className="sr-only">Write a comment</label>
        <textarea
          id="comment-composer"
          ref={composer}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, COMMUNITY.commentMaxLength))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Write a comment"
          rows={1}
          maxLength={COMMUNITY.commentMaxLength}
          enterKeyHint="send"
          className="max-h-30 min-h-11 flex-1 resize-none rounded-[22px] bg-surface-muted px-4 py-2.75 text-body leading-[1.4] text-text outline-none placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary field-sizing-content"
        />
        <button type="submit" aria-label="Post comment" disabled={!canSend} className="grid size-11 shrink-0 place-items-center rounded-full border-0 bg-primary text-on-primary pressable-round disabled:opacity-45">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
      {draft.length > COMMUNITY.commentMaxLength - 100 ? <p className="bg-surface px-4 pb-2 text-right text-micro tabular-nums text-text-secondary">{draft.length}/{COMMUNITY.commentMaxLength}</p> : null}

      <ContentMenu target={menuTarget} onClose={() => setMenuTarget(null)} onDeleted={onDeleted} onBlocked={onBlocked} />
      {profile.element}
    </div>
  );
}

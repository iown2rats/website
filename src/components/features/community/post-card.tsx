"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { photoBackground } from "@/lib/photos";
import { reactionGlyph, reactionLabel, type ReactionKey } from "@/lib/reactions";
import { shortRelativeTime } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { ChatIcon, HeartIcon, ImageIcon, MoreIcon, VerifiedBadge, WhisperIcon } from "@/components/ui/icons";
import { useLongPress } from "@/components/ui/long-press";
import { ReactionSummary } from "@/components/ui/reactions";
import type { CommunityAuthorDto, CommunityPostDto } from "@/server/community/dto";
import type { PollDto } from "@/server/community/polls";
import { TOPICS } from "@/server/community/topics";
import { FollowButton } from "./follow-button";
import { PollBlock } from "./poll-block";

/*
 * Prototype Community post card: radius 24 surface card, 18 px padding, 14 px gaps. Author row = 44 px avatar
 * button, 15/700 name + 14 px seal, 12.5 px secondary meta ("Malé · 2h"), 36 px ··· options button. Optional
 * QUESTION tag, 16 px body at 1.5, 240 px radius-18 photo, then a 38 px action row with heart + count and
 * speech bubble + count. The prototype's Share button has no behaviour and is not rendered (docs §14).
 *
 * Added since: a topic chip, polls, the follow control and the social-context line — all inside the existing card,
 * none of them changing its shape.
 *
 * REACTIONS, and the restraint they are held to. The heart BECAME the reaction control rather than gaining a rival
 * beside it: a plain tap still hearts the post exactly as it always did, a long-press opens the picker, and the
 * button then draws whichever emoji the viewer chose with the same total count next to it. The card's action row
 * is the same 38px row with the same two controls in the same order.
 *
 * The grouped pills appear ONLY when more than one DISTINCT reaction exists, because until then the button itself
 * already says everything — one emoji, one count — and a second row saying it again is the "large row of
 * permanently visible emojis" the brief ruled out. A post nobody has reacted to renders precisely as before.
 *
 * ANONYMOUS POSTS. The card does not decide anonymity and cannot undo it: the server has already replaced the
 * author with a placeholder carrying no handle, no photo and no island (ANONYMOUS_AUTHOR). What this file adds is
 * that the name and avatar stop being buttons, so there is nothing to tap that could ask for a profile, and the
 * follow control is not rendered — following an anonymous author would be a way to find out who they are.
 */

const TOPIC_LABELS = new Map(TOPICS.map((t) => [t.key, t.label]));

export function authorPhotoRef(author: CommunityAuthorDto) {
  return author.photo ? { url: author.photo.url, key: author.photo.demoKey, blurhash: author.photo.blurhash } : null;
}

/** The one-line tag above the body: what kind of post this is, or which chip it sits under. */
function postTag(post: CommunityPostDto): string | null {
  if (post.kind === "CONFESSION") return "Confession";
  if (post.kind === "POLL") return "Poll";
  if (post.kind === "QUESTION") return "Question";
  return post.topic ? (TOPIC_LABELS.get(post.topic) ?? null) : null;
}

/** "12 people joined this conversation · Popular in Malé" — both counted from real rows, or nothing. */
function contextLine(post: CommunityPostDto): string | null {
  const c = post.context;
  if (!c) return null;
  const parts = [`${c.participants} people joined this conversation`];
  if (c.popularIn) parts.push(`Popular in ${c.popularIn}`);
  return parts.join(" · ");
}

export interface PostCardProps {
  post: CommunityPostDto;
  /** Server clock for relative times (never Date.now in render). */
  now: string;
  onToggleLike: (post: CommunityPostDto) => void;
  /** Long-press on the reaction control: open the picker at this point. Omitted where reacting is not offered. */
  onReactionPicker?: (post: CommunityPostDto, point: { x: number; y: number }) => void;
  /** A pill was tapped: set that reaction, or null to clear the viewer's own. */
  onSetReaction?: (post: CommunityPostDto, emoji: ReactionKey | null) => void;
  /** Show who reacted. */
  onInspectReactions?: (post: CommunityPostDto) => void;
  onOpenAuthor: (author: CommunityAuthorDto) => void;
  onOpenMenu: (post: CommunityPostDto) => void;
  /** In the thread view the comments control focuses the composer instead of navigating. */
  onComments?: () => void;
  onPollVoted?: (postId: string, poll: PollDto) => void;
  onFollowChanged?: (handle: string, following: boolean) => void;
  className?: string;
}

export function PostCard({ post, now, onToggleLike, onReactionPicker, onSetReaction, onInspectReactions, onOpenAuthor, onOpenMenu, onComments, onPollVoted, onFollowChanged, className }: PostCardProps) {
  // The tap handler goes THROUGH the hook so the click that follows a long-press does not also toggle the
  // reaction: one gesture, one outcome.
  const longPress = useLongPress((point) => onReactionPicker?.(post, point), { onClick: () => onToggleLike(post) });
  const anonymous = post.isAnonymous;
  const meta = [post.author.location, shortRelativeTime(post.createdAt, new Date(now))].filter(Boolean).join(" · ");
  const photo = post.photo ? { url: post.photo.url, key: post.photo.demoKey, blurhash: post.photo.blurhash } : null;
  const tag = postTag(post);
  const context = contextLine(post);
  const showFollow = !anonymous && !post.isMine && post.author.handle.length > 0;
  const commentsLabel = `Comments (${post.commentCount})`;
  const mine = post.reactions.mine;
  const commentsInner = (
    <>
      <ChatIcon size={16} />
      <span className="tabular-nums">{post.commentCount}</span>
    </>
  );
  const actionClass = "flex h-8 items-center gap-1.5 rounded-md border-0 bg-transparent px-2.5 text-caption hover:bg-surface-muted";

  return (
    <article className={cn("flex shrink-0 flex-col gap-2.5 rounded-card glass-card p-3.5", className)} aria-label={anonymous ? "Anonymous post" : `Post by ${post.author.name}`}>
      <div className="flex items-center gap-2.5">
        {anonymous ? (
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-muted text-text-secondary">
            <WhisperIcon size={18} />
          </span>
        ) : (
          <button type="button" onClick={() => onOpenAuthor(post.author)} aria-label={post.isMine ? "Your profile" : `View ${post.author.name}'s profile`} className="shrink-0 rounded-full border-0 bg-transparent p-0">
            <Avatar name="" aria-hidden="true" photo={authorPhotoRef(post.author)} size={36} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.25 text-body font-medium text-text">
            {anonymous ? (
              <span className="truncate">Anonymous</span>
            ) : (
              <button type="button" onClick={() => onOpenAuthor(post.author)} className="-my-1 truncate border-0 bg-transparent px-0 py-1 text-left text-body font-medium text-text">
                {post.author.name}
              </button>
            )}
            {!anonymous && post.author.verified ? <VerifiedBadge size={13} className="shrink-0" /> : null}
          </div>
          <div className="text-caption-sm text-text-secondary">{anonymous ? shortRelativeTime(post.createdAt, new Date(now)) : meta}</div>
        </div>
        {showFollow ? <FollowButton handle={post.author.handle} following={post.author.followed} onChange={(f) => onFollowChanged?.(post.author.handle, f)} /> : null}
        <button type="button" onClick={() => onOpenMenu(post)} aria-label="Post options" className="grid size-8 shrink-0 place-items-center rounded-md border-0 bg-transparent text-text-secondary hover:bg-surface-muted">
          <MoreIcon size={17} />
        </button>
      </div>

      {tag ? (
        <Tag size="md" className="self-start">
          {tag}
        </Tag>
      ) : null}

      <p className="m-0 whitespace-pre-wrap break-words text-body leading-normal text-text [text-wrap:pretty]">{post.body}</p>

      {post.poll ? <PollBlock postId={post.id} poll={post.poll} onVoted={(poll) => onPollVoted?.(post.id, poll)} /> : null}

      {photo ? (
        <div className="relative h-52 overflow-hidden rounded-lg bg-aqua-soft" style={photoBackground(photo)}>
          {photo.url ? <Image src={photo.url} alt={anonymous ? "Photo in an anonymous post" : `Photo posted by ${post.author.name}`} fill unoptimized sizes="(min-width: 900px) 640px, 100vw" className="object-cover" loading="lazy" /> : <span className="sr-only">Photo</span>}
        </div>
      ) : post.photoUnderReview ? (
        <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg bg-surface-muted text-text-secondary" role="status">
          <ImageIcon size={19} />
          <span className="text-caption font-medium">Photo under review</span>
          <span className="text-micro">Only you can see this post until it&apos;s approved.</span>
        </div>
      ) : null}

      {context ? <p className="m-0 text-caption-sm text-text-secondary">{context}</p> : null}

      {/* Only when the button alone cannot say it: two or more different reactions. */}
      {post.reactions.groups.length > 1 ? (
        <ReactionSummary
          reactions={post.reactions}
          onToggle={onSetReaction ? (emoji) => onSetReaction(post, emoji) : undefined}
          onInspect={onInspectReactions ? () => onInspectReactions(post) : undefined}
          label="Reactions on this post"
          className="-mb-1"
        />
      ) : null}

      <div className="-mb-0.5 flex gap-1 text-text-secondary">
        <button
          type="button"
          {...(onReactionPicker ? longPress : { onClick: () => onToggleLike(post) })}
          aria-pressed={post.likedByMe}
          aria-label={
            mine
              ? `Remove your ${reactionLabel(mine)} reaction (${post.likeCount} in total). Press and hold to choose another`
              : `React (${post.likeCount}). Press and hold to choose a reaction`
          }
          className={cn(actionClass, post.likedByMe && "text-primary-ink")}
        >
          {/* The viewer's own choice, drawn where the heart was. No reaction yet: the outline heart, as before. */}
          {mine ? (
            <span aria-hidden="true" className="text-[15px] leading-none">{reactionGlyph(mine)}</span>
          ) : (
            <HeartIcon size={16} filled={false} />
          )}
          <span className="tabular-nums">{post.likeCount}</span>
        </button>
        {onComments ? (
          <button type="button" onClick={onComments} aria-label={commentsLabel} className={actionClass}>
            {commentsInner}
          </button>
        ) : (
          <Link href={`/community/${post.id}`} aria-label={commentsLabel} className={actionClass}>
            {commentsInner}
          </Link>
        )}
      </div>
    </article>
  );
}

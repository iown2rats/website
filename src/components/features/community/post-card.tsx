"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { photoBackground } from "@/lib/photos";
import { shortRelativeTime } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { ChatIcon, HeartIcon, ImageIcon, MoreIcon, VerifiedBadge } from "@/components/ui/icons";
import type { CommunityAuthorDto, CommunityPostDto } from "@/server/community/dto";

/*
 * Prototype Community post card: radius 24 surface card, 18 px padding, 14 px gaps. Author row = 44 px avatar
 * button, 15/700 name + 14 px seal, 12.5 px secondary meta ("Malé · 2h"), 36 px ··· options button. Optional
 * QUESTION tag, 16 px body at 1.5, 240 px radius-18 photo, then a 38 px action row with heart + count and
 * speech bubble + count. The prototype's Share button has no behaviour and is not rendered (docs §14).
 */

export function authorPhotoRef(author: CommunityAuthorDto) {
  return author.photo ? { url: author.photo.url, key: author.photo.demoKey, blurhash: author.photo.blurhash } : null;
}

export interface PostCardProps {
  post: CommunityPostDto;
  /** Server clock for relative times (never Date.now in render). */
  now: string;
  onToggleLike: (post: CommunityPostDto) => void;
  onOpenAuthor: (author: CommunityAuthorDto) => void;
  onOpenMenu: (post: CommunityPostDto) => void;
  /** In the thread view the comments control focuses the composer instead of navigating. */
  onComments?: () => void;
  className?: string;
}

export function PostCard({ post, now, onToggleLike, onOpenAuthor, onOpenMenu, onComments, className }: PostCardProps) {
  const meta = [post.author.location, shortRelativeTime(post.createdAt, new Date(now))].filter(Boolean).join(" · ");
  const photo = post.photo ? { url: post.photo.url, key: post.photo.demoKey, blurhash: post.photo.blurhash } : null;
  const commentsLabel = `Comments (${post.commentCount})`;
  const commentsInner = (
    <>
      <ChatIcon size={18} />
      <span className="tabular-nums">{post.commentCount}</span>
    </>
  );
  const actionClass = "flex h-9.5 items-center gap-1.5 rounded-md border-0 bg-transparent px-3 text-[13.5px] font-semibold hover:bg-surface-muted";

  return (
    <article className={cn("flex shrink-0 flex-col gap-3.5 rounded-card glass-card p-4.5", className)} aria-label={`Post by ${post.author.name}`}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onOpenAuthor(post.author)} aria-label={post.isMine ? "Your profile" : `View ${post.author.name}'s profile`} className="shrink-0 rounded-full border-0 bg-transparent p-0">
          <Avatar name="" aria-hidden="true" photo={authorPhotoRef(post.author)} size={44} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.25 text-[15px] font-bold text-text">
            <button type="button" onClick={() => onOpenAuthor(post.author)} className="truncate border-0 bg-transparent p-0 text-left text-[15px] font-bold text-text">
              {post.author.name}
            </button>
            {post.author.verified ? <VerifiedBadge size={14} className="shrink-0" /> : null}
          </div>
          <div className="text-[12.5px] text-text-secondary">{meta}</div>
        </div>
        <button type="button" onClick={() => onOpenMenu(post)} aria-label="Post options" className="grid size-9 shrink-0 place-items-center rounded-md border-0 bg-transparent text-text-secondary hover:bg-surface-muted">
          <MoreIcon size={18} />
        </button>
      </div>

      {post.kind === "QUESTION" ? <Tag size="md" className="self-start">Question</Tag> : null}

      <p className="m-0 whitespace-pre-wrap break-words text-body-lg leading-normal text-text [text-wrap:pretty]">{post.body}</p>

      {photo ? (
        <div className="relative h-60 overflow-hidden rounded-xl bg-aqua-soft" style={photoBackground(photo)}>
          {photo.url ? <Image src={photo.url} alt={`Photo posted by ${post.author.name}`} fill unoptimized sizes="(min-width: 900px) 640px, 100vw" className="object-cover" loading="lazy" /> : <span className="sr-only">Photo</span>}
        </div>
      ) : post.photoUnderReview ? (
        <div className="flex h-30 flex-col items-center justify-center gap-1.5 rounded-xl bg-surface-muted text-text-secondary" role="status">
          <ImageIcon size={22} />
          <span className="text-caption font-semibold">Photo under review</span>
          <span className="text-micro">Only you can see this post until it&apos;s approved.</span>
        </div>
      ) : null}

      <div className="flex gap-1.5 text-text-secondary">
        <button
          type="button"
          onClick={() => onToggleLike(post)}
          aria-pressed={post.likedByMe}
          aria-label={`${post.likedByMe ? "Unlike" : "Like"} (${post.likeCount})`}
          className={cn(actionClass, post.likedByMe && "text-primary-ink")}
        >
          <HeartIcon size={18} filled={post.likedByMe} className={post.likedByMe ? "text-primary" : undefined} />
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

"use client";

import Link from "next/link";
import { ChatIcon, FlameIcon, HeartIcon } from "@/components/ui/icons";
import type { PopularPostDto } from "@/server/community/discover";
import { TOPICS } from "@/server/community/topics";

const TOPIC_LABELS = new Map(TOPICS.map((t) => [t.key, t.label]));

/**
 * "🔥 Popular today" (spec §5): the two or three busiest visible discussions of the last day, dropped between
 * feed posts.
 *
 * Every row is a real post with its real reply and like counts, and the server returns nothing at all unless at
 * least two posts clear its floor — so this module is absent on a quiet day rather than padded out with whatever
 * happened to be posted. It never names an author, which is also what makes it safe for anonymous confessions to
 * appear in it.
 */
export function PopularToday({ posts }: { posts: PopularPostDto[] }) {
  if (posts.length === 0) return null;
  return (
    <section className="flex shrink-0 flex-col gap-2 rounded-card glass-card p-3.5" aria-labelledby="popular-today">
      <h2 id="popular-today" className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-[.04em] text-text-secondary">
        <FlameIcon size={15} className="text-primary" />
        Popular today
      </h2>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {posts.map((post) => (
          <li key={post.id}>
            <Link href={`/community/${post.id}`} className="-mx-1.5 flex flex-col gap-1 rounded-lg px-1.5 py-1.5 no-underline hover:bg-surface-muted">
              <span className="line-clamp-2 text-body-sm text-text [text-wrap:pretty]">{post.excerpt}</span>
              <span className="flex items-center gap-2.5 text-caption-sm text-text-secondary">
                {post.topic ? <span className="truncate">{TOPIC_LABELS.get(post.topic) ?? ""}</span> : null}
                <span className="flex items-center gap-1">
                  <ChatIcon size={13} />
                  <span className="tabular-nums">{post.commentCount}</span>
                  <span className="sr-only">replies</span>
                </span>
                <span className="flex items-center gap-1">
                  <HeartIcon size={13} />
                  <span className="tabular-nums">{post.likeCount}</span>
                  <span className="sr-only">likes</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

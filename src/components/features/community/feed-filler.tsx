"use client";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/ui/icons";
import type { CommunityDiscoverDto } from "@/server/community/discover";
import type { CommunityAuthorDto, CommunityPostKind } from "@/server/community/dto";
import { CONVERSATION_STARTERS } from "@/server/community/rules";
import type { TopicKey } from "@/server/community/topics";
import { FollowButton } from "./follow-button";
import { PopularToday } from "./popular-today";

/**
 * What fills the screen when the feed is thin or empty (spec §8).
 *
 * The rule the brief sets is the important part: everything that shows a COUNT or a PERSON comes from real rows,
 * and the only static content is the conversation-starter prompts, which assert nothing about anybody. So a brand
 * new Community — no posts, no members to suggest, no busy topics — falls all the way through to the starters and
 * the create button, and still gives someone a reason to type. It never shows "0 discussions" or an invented
 * "trending" list to fill the gap.
 *
 * Each block is independently absent when it has no data, so this degrades one piece at a time instead of being
 * all-or-nothing.
 */
export interface FeedFillerProps {
  discover: CommunityDiscoverDto | null;
  /** Null while nothing has been chosen; used to phrase the empty line for a filtered feed. */
  topic: TopicKey | null;
  /** How many posts the feed did manage to show — changes the heading from "empty" to "that's everything". */
  postCount: number;
  canPost: boolean;
  onCompose: (kind: CommunityPostKind) => void;
  onPickTopic: (topic: TopicKey | null) => void;
  onOpenAuthor: (author: CommunityAuthorDto) => void;
  onFollowChanged: (handle: string, following: boolean) => void;
}

/** A stable slice of the starters, so the list does not reshuffle under the reader on every render. */
function starters(seed: number, count: number): string[] {
  const start = seed % CONVERSATION_STARTERS.length;
  return Array.from({ length: Math.min(count, CONVERSATION_STARTERS.length) }, (_, i) => CONVERSATION_STARTERS[(start + i) % CONVERSATION_STARTERS.length]!);
}

export function FeedFiller({ discover, topic, postCount, canPost, onCompose, onPickTopic, onOpenAuthor, onFollowChanged }: FeedFillerProps) {
  const suggestions = discover?.suggestions ?? [];
  const activeTopics = (discover?.activeTopics ?? []).filter((t) => t.key !== topic).slice(0, 4);
  const prompts = starters(postCount, 3);

  return (
    <div className="flex shrink-0 flex-col gap-2.5">
      <PopularToday posts={discover?.popular ?? []} />

      {suggestions.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-card glass-card p-3.5" aria-labelledby="community-suggestions">
          <h2 id="community-suggestions" className="text-caption font-medium uppercase tracking-[.04em] text-text-secondary">
            People posting lately
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {suggestions.map(({ author, recentPosts }) => (
              <li key={author.handle} className="flex items-center gap-2.5">
                <button type="button" onClick={() => onOpenAuthor(author)} aria-label={`View ${author.name}'s profile`} className="shrink-0 rounded-full border-0 bg-transparent p-0">
                  <Avatar name="" aria-hidden="true" photo={author.photo ? { url: author.photo.url, key: author.photo.demoKey, blurhash: author.photo.blurhash } : null} size={36} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.25">
                    <button type="button" onClick={() => onOpenAuthor(author)} className="truncate border-0 bg-transparent p-0 text-left text-body font-medium text-text">
                      {author.name}
                    </button>
                    {author.verified ? <VerifiedBadge size={13} className="shrink-0" /> : null}
                  </div>
                  <p className="m-0 truncate text-caption-sm text-text-secondary">
                    {[author.location, `${recentPosts} ${recentPosts === 1 ? "post" : "posts"} recently`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <FollowButton handle={author.handle} following={author.followed} onChange={(f) => onFollowChanged(author.handle, f)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {activeTopics.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-card glass-card p-3.5" aria-labelledby="community-active-topics">
          <h2 id="community-active-topics" className="text-caption font-medium uppercase tracking-[.04em] text-text-secondary">
            Busy this week
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {activeTopics.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onPickTopic(t.key)}
                className="flex h-8 items-center gap-1.5 rounded-full border-0 bg-surface-muted px-3 text-body-sm font-medium text-text"
              >
                {t.label}
                <span className="text-caption-sm tabular-nums text-text-secondary">{t.posts}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 rounded-card glass-card p-3.5" aria-labelledby="community-starters">
        <h2 id="community-starters" className="text-caption font-medium uppercase tracking-[.04em] text-text-secondary">
          Start a conversation
        </h2>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {prompts.map((prompt) => (
            <li key={prompt}>
              <button
                type="button"
                disabled={!canPost}
                onClick={() => onCompose("QUESTION")}
                className="-mx-1.5 w-[calc(100%+0.75rem)] rounded-lg border-0 bg-transparent px-1.5 py-1.5 text-left text-body-sm text-text hover:bg-surface-muted disabled:opacity-60 [text-wrap:pretty]"
              >
                {prompt}
              </button>
            </li>
          ))}
        </ul>
        {canPost ? (
          <Button variant="ocean" size="sm" onClick={() => onCompose("TEXT")} className="self-start">
            Write a post
          </Button>
        ) : null}
      </section>
    </div>
  );
}

"use server";

import { z } from "zod";
import { getDb } from "@/lib/db";
import { isDomainError, NotFoundError } from "@/lib/errors";
import { requireMember } from "@/server/auth/current-user";
import { addComment, deleteComment, listComments, type CommentsPage } from "@/server/community/comments";
import { getCommunityDiscover, type CommunityDiscoverDto } from "@/server/community/discover";
import type { CommunityCommentDto, CommunityPostDto } from "@/server/community/dto";
import { getFeed, getPost, type FeedPage, type FeedTab } from "@/server/community/feed";
import { followMember, unfollowMember } from "@/server/community/follows";
import { votePoll, type PollDto } from "@/server/community/polls";
import { deletePost } from "@/server/community/posts";
import { getCommunityProfile } from "@/server/community/profile";
import {
  listCommentReactors,
  listPostReactors,
  setCommentReaction,
  setPostReaction,
  setReaction,
  type CommentReactionResult,
  type CommunityReactorDto,
  type PostReactionResult,
} from "@/server/community/reactions";
import { REACTIONS, type ReactionKey } from "@/lib/reactions";
import { blockCommentAuthor, blockPostAuthor, reportComment, reportPost } from "@/server/community/reports";
import { TOPICS, type TopicKey } from "@/server/community/topics";
import type { DiscoveryCardDto } from "@/server/discovery/dto";

/*
 * Community server actions (Phase 8). The acting user is the session user; payloads carry post/comment ids that are
 * re-authorised (visibility, ownership) on every call. Server actions are cookie-scoped POSTs and are never cached.
 * Post creation with an optional photo goes through POST /api/community/posts (multipart) for upload progress.
 */

const idSchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);
const topicSchema = z.enum(TOPICS.map((t) => t.key) as [TopicKey, ...TopicKey[]]);
const feedSchema = z.object({
  tab: z.enum(["FOR_YOU", "FOLLOWING", "NEW"]).default("FOR_YOU"),
  topic: topicSchema.nullable().optional(),
  cursor: z.string().max(200).nullable().optional(),
});
const handleSchema = z.string().min(1).max(64);
const voteSchema = z.object({ postId: idSchema, optionId: idSchema });
const commentsSchema = z.object({ postId: idSchema, cursor: z.string().max(200).nullable().optional() });
const reactSchema = z.object({ postId: idSchema, liked: z.boolean() });
/*
 * The approved set, checked here as well as in the domain and again by the database's own enum. `nullable` is how
 * "I have no reaction" is expressed: these actions are declarative — the payload is the state the member wants —
 * so a retried request is harmless and cannot toggle something back on.
 */
const emojiSchema = z.enum(REACTIONS.map((r) => r.key) as [ReactionKey, ...ReactionKey[]]).nullable();
const postEmojiSchema = z.object({ postId: idSchema, emoji: emojiSchema });
const commentEmojiSchema = z.object({ commentId: idSchema, emoji: emojiSchema });
const commentIdSchema = z.object({ commentId: idSchema });
const commentSchema = z.object({ postId: idSchema, body: z.string().max(4000) });

export type CommunityFailure = { ok: false; code: "NOT_FOUND" | "VALIDATION" | "UNAVAILABLE" | "ERROR"; message: string };

function failure(e: unknown): CommunityFailure {
  if (isDomainError(e)) {
    if (e.code === "NOT_FOUND") return { ok: false, code: "NOT_FOUND", message: "That's no longer available." };
    if (e.code === "VALIDATION") return { ok: false, code: "VALIDATION", message: e.message };
    if (e.code === "INVALID_STATE") return { ok: false, code: "UNAVAILABLE", message: e.message };
  }
  console.error("[community] action failed", e);
  return { ok: false, code: "ERROR", message: "Mellocrush couldn't do that right now. Try again." };
}

export async function loadFeed(input: unknown): Promise<({ ok: true } & FeedPage) | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = feedSchema.parse(input ?? {});
    return { ok: true, ...(await getFeed(actor, { tab: parsed.tab as FeedTab, topic: parsed.topic ?? null, cursor: parsed.cursor ?? null })) };
  } catch (e) {
    return failure(e);
  }
}

/** The post card's plain tap: add a ❤️, or clear whatever reaction the member had. */
export async function reactToPost(input: unknown): Promise<({ ok: true; liked: boolean } & PostReactionResult) | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = reactSchema.parse(input);
    return { ok: true, ...(await setReaction(actor, parsed.postId, parsed.liked)) };
  } catch (e) {
    return failure(e);
  }
}

/** Sets the member's reaction to a post from the picker. `emoji: null` clears it. */
export async function setPostEmoji(input: unknown): Promise<({ ok: true } & PostReactionResult) | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = postEmojiSchema.parse(input);
    return { ok: true, ...(await setPostReaction(actor, parsed.postId, parsed.emoji)) };
  } catch (e) {
    return failure(e);
  }
}

/** Sets the member's reaction to a comment. `emoji: null` clears it. */
export async function setCommentEmoji(input: unknown): Promise<({ ok: true } & CommentReactionResult) | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = commentEmojiSchema.parse(input);
    return { ok: true, ...(await setCommentReaction(actor, parsed.commentId, parsed.emoji)) };
  } catch (e) {
    return failure(e);
  }
}

/** Who reacted to a post, and with what. Bounded and filtered by the same rules as the feed. */
export async function loadPostReactorList(input: unknown): Promise<{ ok: true; reactors: CommunityReactorDto[] } | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = z.object({ postId: idSchema }).parse(input);
    return { ok: true, reactors: await listPostReactors(actor, parsed.postId) };
  } catch (e) {
    return failure(e);
  }
}

/** Who reacted to a comment, and with what. */
export async function loadCommentReactorList(input: unknown): Promise<{ ok: true; reactors: CommunityReactorDto[] } | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = commentIdSchema.parse(input);
    return { ok: true, reactors: await listCommentReactors(actor, parsed.commentId) };
  } catch (e) {
    return failure(e);
  }
}

export async function loadPost(input: unknown): Promise<{ ok: true; post: CommunityPostDto } | CommunityFailure> {
  try {
    const actor = await requireMember();
    const postId = idSchema.parse((input as { postId?: unknown })?.postId);
    return { ok: true, post: await getPost(actor, postId) };
  } catch (e) {
    return failure(e);
  }
}

export async function loadComments(input: unknown): Promise<({ ok: true } & CommentsPage) | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = commentsSchema.parse(input);
    return { ok: true, ...(await listComments(actor, parsed.postId, { cursor: parsed.cursor ?? null })) };
  } catch (e) {
    return failure(e);
  }
}

export async function postComment(input: unknown): Promise<{ ok: true; comment: CommunityCommentDto } | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = commentSchema.parse(input);
    return { ok: true, comment: await addComment(actor, parsed.postId, parsed.body) };
  } catch (e) {
    return failure(e);
  }
}

export async function removeComment(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireMember();
    await deleteComment(actor, idSchema.parse((input as { commentId?: unknown })?.commentId));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function removePost(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireMember();
    await deletePost(actor, idSchema.parse((input as { postId?: unknown })?.postId));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function reportCommunityPost(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireMember();
    await reportPost(actor, input);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function reportCommunityComment(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireMember();
    await reportComment(actor, input);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function blockAuthorOfPost(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireMember();
    await blockPostAuthor(actor, idSchema.parse((input as { postId?: unknown })?.postId));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function blockAuthorOfComment(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireMember();
    await blockCommentAuthor(actor, idSchema.parse((input as { commentId?: unknown })?.commentId));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function loadCommunityProfile(input: unknown): Promise<{ ok: true; profile: DiscoveryCardDto } | CommunityFailure> {
  try {
    const actor = await requireMember();
    const handle = z.string().min(1).max(64).parse((input as { handle?: unknown })?.handle);
    return { ok: true, profile: await getCommunityProfile(actor, handle) };
  } catch (e) {
    return failure(e);
  }
}

/**
 * The modules beside the feed. Separate from loadFeed so a thin or empty feed can fill the space without the
 * common case paying for three extra aggregate queries on every page of scrolling.
 */
export async function loadCommunityDiscover(): Promise<({ ok: true } & CommunityDiscoverDto) | CommunityFailure> {
  try {
    const actor = await requireMember();
    return { ok: true, ...(await getCommunityDiscover(actor)) };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Follow / unfollow, by handle so the client never needs a user id. Private: the person followed is not notified
 * and cannot discover it, and the result says only what the VIEWER's own state now is.
 */
export async function setFollow(input: unknown): Promise<{ ok: true; following: boolean } | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = z.object({ handle: handleSchema, following: z.boolean() }).parse(input);
    const target = await getDb().profile.findUnique({ where: { handle: parsed.handle }, select: { userId: true } });
    if (!target) throw new NotFoundError("Member");
    const r = parsed.following ? await followMember(actor, target.userId) : await unfollowMember(actor, target.userId);
    return { ok: true, following: r.following };
  } catch (e) {
    return failure(e);
  }
}

export async function voteOnPoll(input: unknown): Promise<{ ok: true; poll: PollDto } | CommunityFailure> {
  try {
    const actor = await requireMember();
    const parsed = voteSchema.parse(input);
    return { ok: true, poll: await votePoll(actor, parsed) };
  } catch (e) {
    return failure(e);
  }
}

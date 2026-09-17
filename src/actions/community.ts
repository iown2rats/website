"use server";

import { z } from "zod";
import { isDomainError } from "@/lib/errors";
import { requireActor } from "@/server/auth/current-user";
import { addComment, deleteComment, listComments, type CommentsPage } from "@/server/community/comments";
import type { CommunityCommentDto, CommunityPostDto } from "@/server/community/dto";
import { getFeed, getPost, type FeedPage, type FeedTab } from "@/server/community/feed";
import { deletePost } from "@/server/community/posts";
import { getCommunityProfile } from "@/server/community/profile";
import { setReaction } from "@/server/community/reactions";
import { blockCommentAuthor, blockPostAuthor, reportComment, reportPost } from "@/server/community/reports";
import type { DiscoveryCardDto } from "@/server/discovery/dto";

/*
 * Community server actions (Phase 8). The acting user is the session user; payloads carry post/comment ids that are
 * re-authorised (visibility, ownership) on every call. Server actions are cookie-scoped POSTs and are never cached.
 * Post creation with an optional photo goes through POST /api/community/posts (multipart) for upload progress.
 */

const idSchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);
const feedSchema = z.object({ tab: z.enum(["FOR_YOU", "NEW"]).default("FOR_YOU"), cursor: z.string().max(200).nullable().optional() });
const commentsSchema = z.object({ postId: idSchema, cursor: z.string().max(200).nullable().optional() });
const reactSchema = z.object({ postId: idSchema, liked: z.boolean() });
const commentSchema = z.object({ postId: idSchema, body: z.string().max(4000) });

export type CommunityFailure = { ok: false; code: "NOT_FOUND" | "VALIDATION" | "UNAVAILABLE" | "ERROR"; message: string };

function failure(e: unknown): CommunityFailure {
  if (isDomainError(e)) {
    if (e.code === "NOT_FOUND") return { ok: false, code: "NOT_FOUND", message: "That's no longer available." };
    if (e.code === "VALIDATION") return { ok: false, code: "VALIDATION", message: e.message };
    if (e.code === "INVALID_STATE") return { ok: false, code: "UNAVAILABLE", message: e.message };
  }
  console.error("[community] action failed", e);
  return { ok: false, code: "ERROR", message: "Thundi couldn't do that right now. Try again." };
}

export async function loadFeed(input: unknown): Promise<({ ok: true } & FeedPage) | CommunityFailure> {
  try {
    const actor = await requireActor();
    const parsed = feedSchema.parse(input ?? {});
    return { ok: true, ...(await getFeed(actor, { tab: parsed.tab as FeedTab, cursor: parsed.cursor ?? null })) };
  } catch (e) {
    return failure(e);
  }
}

export async function reactToPost(input: unknown): Promise<{ ok: true; liked: boolean; likeCount: number } | CommunityFailure> {
  try {
    const actor = await requireActor();
    const parsed = reactSchema.parse(input);
    return { ok: true, ...(await setReaction(actor, parsed.postId, parsed.liked)) };
  } catch (e) {
    return failure(e);
  }
}

export async function loadPost(input: unknown): Promise<{ ok: true; post: CommunityPostDto } | CommunityFailure> {
  try {
    const actor = await requireActor();
    const postId = idSchema.parse((input as { postId?: unknown })?.postId);
    return { ok: true, post: await getPost(actor, postId) };
  } catch (e) {
    return failure(e);
  }
}

export async function loadComments(input: unknown): Promise<({ ok: true } & CommentsPage) | CommunityFailure> {
  try {
    const actor = await requireActor();
    const parsed = commentsSchema.parse(input);
    return { ok: true, ...(await listComments(actor, parsed.postId, { cursor: parsed.cursor ?? null })) };
  } catch (e) {
    return failure(e);
  }
}

export async function postComment(input: unknown): Promise<{ ok: true; comment: CommunityCommentDto } | CommunityFailure> {
  try {
    const actor = await requireActor();
    const parsed = commentSchema.parse(input);
    return { ok: true, comment: await addComment(actor, parsed.postId, parsed.body) };
  } catch (e) {
    return failure(e);
  }
}

export async function removeComment(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireActor();
    await deleteComment(actor, idSchema.parse((input as { commentId?: unknown })?.commentId));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function removePost(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireActor();
    await deletePost(actor, idSchema.parse((input as { postId?: unknown })?.postId));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function reportCommunityPost(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireActor();
    await reportPost(actor, input);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function reportCommunityComment(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireActor();
    await reportComment(actor, input);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function blockAuthorOfPost(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireActor();
    await blockPostAuthor(actor, idSchema.parse((input as { postId?: unknown })?.postId));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function blockAuthorOfComment(input: unknown): Promise<{ ok: true } | CommunityFailure> {
  try {
    const actor = await requireActor();
    await blockCommentAuthor(actor, idSchema.parse((input as { commentId?: unknown })?.commentId));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function loadCommunityProfile(input: unknown): Promise<{ ok: true; profile: DiscoveryCardDto } | CommunityFailure> {
  try {
    const actor = await requireActor();
    const handle = z.string().min(1).max(64).parse((input as { handle?: unknown })?.handle);
    return { ok: true, profile: await getCommunityProfile(actor, handle) };
  } catch (e) {
    return failure(e);
  }
}

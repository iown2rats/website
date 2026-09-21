/**
 * Community posts: create (text, question, photo, poll, confession) and soft-delete by the author. Photo posts go
 * through the shared image pipeline into user-scoped keys `community-photos/<userId>/<postId>/full.webp` with their
 * own moderation state. Nothing here touches likes, matches or conversations.
 *
 * Two rules are enforced here rather than trusted from the payload:
 *
 *   - `isAnonymous` is DERIVED from the kind, never read from the request. A confession is anonymous, everything
 *     else is not, and there is no way to ask for an anonymous photo post or a named confession. A client cannot
 *     set the flag at all, so there is no path by which it drifts away from what the UI promised the author.
 *   - the author id is the session user for every kind, confessions included. Anonymity lives in the DTO
 *     (src/server/community/dto.ts); the row always names who wrote it, so reports, blocks and the admin queues
 *     work on a confession exactly as they work on any other post.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { COMMUNITY } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { processImage } from "@/server/media/process-image";
import { buildPostDtos } from "./feed";
import type { CommunityPostDto, CommunityPostKind } from "./dto";
import { parsePollOptions } from "./polls";
import { parseTopic, suggestedTopic, type TopicKey } from "./topics";

export const postBodySchema = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, "\n").replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\t" ? c : "")).trim())
  .pipe(z.string().min(1, "Write something first").max(COMMUNITY.postMaxLength, `Posts can be up to ${COMMUNITY.postMaxLength} characters`));

export const postKindSchema = z.enum(["TEXT", "QUESTION", "PHOTO", "POLL", "CONFESSION"]);

export interface CreatePostInput {
  kind: CommunityPostKind;
  body: string;
  /** Chip the author picked. Ignored when not one of the six; the kind then supplies a sensible default. */
  topic?: string | null;
  photo?: { bytes: Uint8Array; size: number } | null;
  /** POLL only: 2-4 distinct labels. Rejected for every other kind. */
  pollOptions?: unknown;
}

export async function createPost(actor: Actor, input: CreatePostInput, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<CommunityPostDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const kind = postKindSchema.parse(input.kind);
  const parsed = postBodySchema.safeParse(input.body ?? "");
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "That post isn't valid");
  const body = parsed.data;
  if (kind === "PHOTO" && !input.photo) throw new ValidationError("Add a photo to your photo post");
  if (kind !== "PHOTO" && input.photo) throw new ValidationError("Only photo posts can include a photo");
  const hasOptions = input.pollOptions != null;
  if (kind === "POLL" && !hasOptions) throw new ValidationError("Add some options to your poll.");
  if (kind !== "POLL" && hasOptions) throw new ValidationError("Only polls can have options.");
  const pollOptions = kind === "POLL" ? parsePollOptions(input.pollOptions) : [];
  const topic: TopicKey | null = parseTopic(input.topic) ?? suggestedTopic(kind);
  // Derived, never taken from the request: see the note at the top of this file.
  const isAnonymous = kind === "CONFESSION";

  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { accountType: true, status: true, privacy: { select: { invisibleMode: true } } } });
  if (!user || user.status !== "ACTIVE") throw new InvalidStateError("Your account can't post right now");
  // Community is a member space. An operational account moderates it; it never takes part in it (§18).
  if (user.accountType !== "MEMBER") throw new InvalidStateError("Staff accounts don't take part in Community");
  // The stored flag is the right test here, not the entitlement: a member is hidden from Discover whenever the flag
  // is on, with or without Plus (src/server/privacy/invisible-mode.ts), and this rule mirrors that hiding.
  if (COMMUNITY.invisibleModeParticipation === "READ_ONLY" && user.privacy?.invisibleMode) throw new InvalidStateError("Community posting is paused while Invisible Mode is on");

  const limit = await consumeRateLimit(db, `community:post:${actor.userId}`, COMMUNITY.postsPerHour, 3_600_000, now);
  if (!limit.allowed) throw new ValidationError("You've posted a lot in the last hour. Take a break and try again soon.");

  const postId = randomUUID().replace(/-/g, "");
  let photoKey: string | null = null;
  let photoBlurhash: string | null = null;
  if (input.photo) {
    const processed = await processImage(input.photo.bytes, { maxWidth: 1440, maxHeight: 1440 });
    photoKey = `community-photos/${actor.userId}/${postId}/full.webp`;
    photoBlurhash = processed.blurhash;
    await storage.put(photoKey, processed.full, "image/webp");
  }
  // The post and its options land together, so a poll is never briefly visible with nothing to vote on.
  await db.$transaction(async (tx) => {
    await tx.communityPost.create({
      data: { id: postId, authorId: actor.userId, kind, topic, isAnonymous, body, photoKey, photoBlurhash, photoModeration: photoKey ? "PENDING" : "APPROVED", createdAt: now },
      select: { id: true },
    });
    if (pollOptions.length > 0) {
      await tx.communityPollOption.createMany({ data: pollOptions.map((label, position) => ({ postId, label, position, createdAt: now })) });
    }
  });
  const [dto] = await buildPostDtos(db, storage, actor, [postId]);
  if (!dto) throw new NotFoundError("Post");
  return dto;
}

/** Soft delete by the author only (ownership from the session, never from the payload). Media and reports are kept as evidence. */
export async function deletePost(actor: Actor, postId: string, options: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const result = await db.communityPost.updateMany({ where: { id: postId, authorId: actor.userId, deletedAt: null }, data: { deletedAt: now } });
  if (result.count === 0) throw new NotFoundError("Post");
  await db.notification.updateMany({ where: { postId, readAt: null }, data: { readAt: now } });
}

/**
 * Community posts: create (text, question, photo) and soft-delete by the author. Photo posts go through the shared
 * image pipeline into user-scoped keys `community-photos/<userId>/<postId>/full.webp` with their own moderation state.
 * Nothing here touches likes, matches or conversations.
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
import type { CommunityPostDto } from "./dto";

export const postBodySchema = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, "\n").replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\t" ? c : "")).trim())
  .pipe(z.string().min(1, "Write something first").max(COMMUNITY.postMaxLength, `Posts can be up to ${COMMUNITY.postMaxLength} characters`));

export const postKindSchema = z.enum(["TEXT", "QUESTION", "PHOTO"]);

export interface CreatePostInput {
  kind: "TEXT" | "QUESTION" | "PHOTO";
  body: string;
  photo?: { bytes: Uint8Array; size: number } | null;
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

  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { status: true, privacy: { select: { invisibleMode: true } } } });
  if (!user || user.status !== "ACTIVE") throw new InvalidStateError("Your account can't post right now");
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
  const post = await db.communityPost.create({
    data: { id: postId, authorId: actor.userId, kind, body, photoKey, photoBlurhash, photoModeration: photoKey ? "PENDING" : "APPROVED", createdAt: now },
    select: { id: true },
  });
  const [dto] = await buildPostDtos(db, storage, actor, [post.id]);
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

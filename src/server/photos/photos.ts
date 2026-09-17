/**
 * Profile photos (docs/ARCHITECTURE.md §6; Phase 5 §13–15).
 * Uploads are processed server-side: real type sniffed with sharp, EXIF stripped, re-encoded to WebP at two
 * sizes, blurhash computed, stored under a user-scoped key. Delete and reorder check ownership through the
 * actor's profile, never through client-supplied ids alone.
 */
import { randomUUID } from "node:crypto";
import { encode as encodeBlurhash } from "blurhash";
import sharp, { type Metadata } from "sharp";
import { PHOTO_LIMITS } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";

export const PHOTO_RULES = {
  max: PHOTO_LIMITS.max,
  min: PHOTO_LIMITS.min,
  maxBytes: 8 * 1024 * 1024,
  minDimension: 400,
  fullMaxWidth: 1080,
  fullMaxHeight: 1440,
  thumbWidth: 400,
  allowedFormats: ["jpeg", "png", "webp"] as const,
} as const;

export interface PhotoDto {
  id: string;
  position: number;
  url: string;
  thumbUrl: string;
  blurhash: string;
  width: number;
  height: number;
  moderation: "PENDING" | "APPROVED" | "REJECTED";
  isPrimary: boolean;
}

export interface UploadInput {
  bytes: Uint8Array;
  declaredType?: string | null;
  size: number;
}

async function profileIdFor(db: DbLike, actor: Actor): Promise<string> {
  const profile = await db.profile.findUnique({ where: { userId: actor.userId }, select: { id: true } });
  if (!profile) throw new InvalidStateError("Add your name before adding photos");
  return profile.id;
}

export async function processAndStorePhoto(actor: Actor, input: UploadInput, deps: { db?: Db; storage: StorageProvider; now?: Date }): Promise<PhotoDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (input.size > PHOTO_RULES.maxBytes || input.bytes.byteLength > PHOTO_RULES.maxBytes) throw new ValidationError("That photo is too large. Choose one under 8 MB.");
  if (input.bytes.byteLength === 0) throw new ValidationError("That file is empty.");

  const profileId = await profileIdFor(db, actor);
  const count = await db.profilePhoto.count({ where: { profileId } });
  if (count >= PHOTO_RULES.max) throw new ValidationError(`You can have up to ${PHOTO_RULES.max} photos.`);

  // Sniff the real format; the browser's MIME type is not trusted.
  let meta: Metadata;
  try {
    meta = await sharp(input.bytes, { failOn: "error", limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new ValidationError("That file isn't a photo we can use. Try a JPG, PNG or WebP.");
  }
  if (!meta.format || !(PHOTO_RULES.allowedFormats as readonly string[]).includes(meta.format)) {
    throw new ValidationError("That file isn't a photo we can use. Try a JPG, PNG or WebP.");
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < PHOTO_RULES.minDimension || h < PHOTO_RULES.minDimension) throw new ValidationError("That photo is too small. Use one at least 400 px wide and tall.");

  // rotate() applies EXIF orientation; toFormat without withMetadata() drops EXIF (including GPS).
  const base = sharp(input.bytes, { limitInputPixels: 50_000_000 }).rotate();
  const full = await base.clone().resize({ width: PHOTO_RULES.fullMaxWidth, height: PHOTO_RULES.fullMaxHeight, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const thumb = await base.clone().resize({ width: PHOTO_RULES.thumbWidth, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const tiny = await base.clone().resize(32, 32, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const blurhash = encodeBlurhash(new Uint8ClampedArray(tiny.data), tiny.info.width, tiny.info.height, 4, 3);

  const photoId = randomUUID();
  const storageKey = `profile-photos/${actor.userId}/${photoId}/full.webp`;
  const thumbKey = `profile-photos/${actor.userId}/${photoId}/thumb.webp`;
  await deps.storage.put(storageKey, new Uint8Array(full.data), "image/webp");
  await deps.storage.put(thumbKey, new Uint8Array(thumb), "image/webp");

  const created = await db.$transaction(async (tx) => {
    // Lock the profile row so concurrent uploads cannot exceed the maximum or collide on position.
    await tx.$executeRaw`SELECT id FROM "Profile" WHERE id = ${profileId} FOR UPDATE`;
    const current = await tx.profilePhoto.count({ where: { profileId } });
    if (current >= PHOTO_RULES.max) throw new ValidationError(`You can have up to ${PHOTO_RULES.max} photos.`);
    const last = await tx.profilePhoto.findFirst({ where: { profileId }, orderBy: { position: "desc" }, select: { position: true } });
    return tx.profilePhoto.create({
      data: { id: photoId, profileId, position: (last?.position ?? -1) + 1, storageKey, thumbKey, blurhash, width: full.info.width, height: full.info.height, moderation: "PENDING", createdAt: now },
    });
  }).catch(async (e) => {
    await deps.storage.delete([storageKey, thumbKey]).catch(() => undefined);
    throw e;
  });

  const photos = await listPhotos(actor, { db, storage: deps.storage });
  return photos.find((p) => p.id === created.id)!;
}

export async function listPhotos(actor: Actor, deps: { db?: Db; storage: StorageProvider }): Promise<PhotoDto[]> {
  const db = deps.db ?? getDb();
  const rows = await db.profilePhoto.findMany({ where: { profile: { userId: actor.userId } }, orderBy: { position: "asc" } });
  const primaryId = rows.find((r) => r.moderation !== "REJECTED")?.id ?? null;
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      position: r.position,
      url: await deps.storage.getReadUrl(r.storageKey, PHOTO_URL_TTL_SECONDS),
      thumbUrl: await deps.storage.getReadUrl(r.thumbKey, PHOTO_URL_TTL_SECONDS),
      blurhash: r.blurhash,
      width: r.width,
      height: r.height,
      moderation: r.moderation,
      isPrimary: r.id === primaryId,
    })),
  );
}

/** Deletes one of the actor's photos and renumbers the rest. Unknown or foreign ids read as NotFound. */
export async function deletePhoto(actor: Actor, photoId: string, deps: { db?: Db; storage: StorageProvider }): Promise<void> {
  const db = deps.db ?? getDb();
  const photo = await db.profilePhoto.findFirst({ where: { id: photoId, profile: { userId: actor.userId } }, select: { id: true, profileId: true, storageKey: true, thumbKey: true } });
  if (!photo) throw new NotFoundError("Photo");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Profile" WHERE id = ${photo.profileId} FOR UPDATE`;
    await tx.profilePhoto.delete({ where: { id: photo.id } });
    const rest = await tx.profilePhoto.findMany({ where: { profileId: photo.profileId }, orderBy: { position: "asc" }, select: { id: true } });
    await renumber(tx, rest.map((r) => r.id));
  });
  await deps.storage.delete([photo.storageKey, photo.thumbKey]).catch(() => undefined);
}

/** Reorders the actor's photos. The id list must be exactly the actor's photo set. */
export async function reorderPhotos(actor: Actor, orderedIds: string[], deps: { db?: Db }): Promise<void> {
  const db = deps.db ?? getDb();
  const profileId = await profileIdFor(db, actor);
  const owned = await db.profilePhoto.findMany({ where: { profileId }, select: { id: true } });
  const ownedIds = new Set(owned.map((p) => p.id));
  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length || unique.size !== ownedIds.size || ![...unique].every((id) => ownedIds.has(id))) {
    throw new NotFoundError("Photo");
  }
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Profile" WHERE id = ${profileId} FOR UPDATE`;
    await renumber(tx, orderedIds);
  });
}

/** Two-phase renumbering avoids transient unique (profileId, position) collisions. */
async function renumber(tx: DbLike, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) await tx.profilePhoto.update({ where: { id: ids[i]! }, data: { position: -(i + 1) } });
  for (let i = 0; i < ids.length; i++) await tx.profilePhoto.update({ where: { id: ids[i]! }, data: { position: i } });
}

export async function countActivePhotos(db: DbLike, userId: string): Promise<number> {
  return db.profilePhoto.count({ where: { profile: { userId }, moderation: { not: "REJECTED" } } });
}

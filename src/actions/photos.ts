"use server";

import { isDomainError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { photoIdSchema, reorderPhotosSchema } from "@/lib/validation/onboarding";
import { requireActor } from "@/server/auth/current-user";
import { deletePhoto, listPhotos, reorderPhotos, type PhotoDto } from "@/server/photos/photos";

export type PhotoActionResult = { ok: true; photos: PhotoDto[] } | { ok: false; error: string };

function friendly(e: unknown): PhotoActionResult {
  return { ok: false, error: isDomainError(e) ? e.message : "Something went wrong. Please try again." };
}

export async function removePhoto(input: { photoId: string }): Promise<PhotoActionResult> {
  const actor = await requireActor();
  const parsed = photoIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid photo" };
  try {
    const storage = getStorageProvider();
    await deletePhoto(actor, parsed.data.photoId, { storage });
    return { ok: true, photos: await listPhotos(actor, { storage }) };
  } catch (e) {
    return friendly(e);
  }
}

export async function reorderMyPhotos(input: { photoIds: string[] }): Promise<PhotoActionResult> {
  const actor = await requireActor();
  const parsed = reorderPhotosSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order" };
  try {
    const storage = getStorageProvider();
    await reorderPhotos(actor, parsed.data.photoIds, {});
    return { ok: true, photos: await listPhotos(actor, { storage }) };
  } catch (e) {
    return friendly(e);
  }
}

export async function refreshPhotos(): Promise<PhotoActionResult> {
  const actor = await requireActor();
  try {
    return { ok: true, photos: await listPhotos(actor, { storage: getStorageProvider() }) };
  } catch (e) {
    return friendly(e);
  }
}

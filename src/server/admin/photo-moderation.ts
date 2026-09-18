/**
 * Profile-photo moderation (docs/ARCHITECTURE.md §6.1, §21.5). Every uploaded photo starts PENDING and is invisible
 * to other members until a human approves it: production displays APPROVED only (src/lib/photo-policy.ts), and the
 * discovery predicate counts displayable photos, so nothing here weakens that rule — approving a photo is the only
 * way a profile becomes discoverable.
 *
 * Rules that hold throughout:
 *  - Reads and writes both require the `photos.moderate` permission; the UI never decides who may act.
 *  - A decision applies only to a photo that is still PENDING, taken under a row lock. A second reviewer acting on
 *    a stale queue is refused rather than silently overwriting the first decision.
 *  - Nobody reviews their own photo.
 *  - Evidence URLs are short-lived and signed, and exist only for the reviewing admin.
 */
import { z } from "zod";
import { getDb, type Db } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import { noMarkup } from "@/lib/validation/onboarding";
import { AUDIT_ACTIONS, writeAudit } from "./audit";
import { assertPermission, type AdminActor } from "./authz";

export type PhotoDecision = "APPROVED" | "REJECTED";

export interface PendingPhotoRowDto {
  photoId: string;
  userId: string;
  handle: string | null;
  displayName: string | null;
  accountStatus: string;
  /** 0 is the member's main photo — worth knowing, because rejecting it changes what their profile leads with. */
  position: number;
  isPrimary: boolean;
  moderation: string;
  uploadedAt: string;
  /** Signed and short-lived. Null for development demo placeholders, which render as a gradient from `demoKey`. */
  url: string | null;
  demoKey: string | null;
  /** How many of this member's photos are already approved, so a reviewer can see the effect of a rejection. */
  approvedCount: number;
  pendingCount: number;
}

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: noMarkup(300, "Reason").optional().default(""),
});

/** The queue: every photo still waiting for a decision, newest upload first. */
export async function listPendingPhotos(
  admin: AdminActor,
  deps: { db?: Db; storage?: StorageProvider; page?: number; pageSize?: number } = {},
): Promise<{ items: PendingPhotoRowDto[]; total: number; page: number; pageSize: number }> {
  assertPermission(admin, "photos.moderate");
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const page = Math.max(1, deps.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, deps.pageSize ?? 24));
  const where = { moderation: "PENDING" as const };
  const [rows, total] = await Promise.all([
    db.profilePhoto.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        position: true,
        thumbKey: true,
        moderation: true,
        createdAt: true,
        profile: {
          select: {
            handle: true,
            displayName: true,
            user: { select: { id: true, status: true } },
            photos: { select: { moderation: true } },
          },
        },
      },
    }),
    db.profilePhoto.count({ where }),
  ]);
  const items = await Promise.all(
    rows.map(async (r) => {
      const demo = r.thumbKey.startsWith("demo/");
      return {
        photoId: r.id,
        userId: r.profile.user.id,
        handle: r.profile.handle,
        displayName: r.profile.displayName,
        accountStatus: r.profile.user.status,
        position: r.position,
        isPrimary: r.position === 0,
        moderation: r.moderation,
        uploadedAt: r.createdAt.toISOString(),
        url: demo ? null : await storage.getReadUrl(r.thumbKey, PHOTO_URL_TTL_SECONDS),
        demoKey: demo ? r.thumbKey : null,
        approvedCount: r.profile.photos.filter((p) => p.moderation === "APPROVED").length,
        pendingCount: r.profile.photos.filter((p) => p.moderation === "PENDING").length,
      };
    }),
  );
  return { items, total, page, pageSize };
}

/** How many photos are waiting, for the navigation badge. Cheap enough to run on every admin page load. */
export async function countPendingPhotos(db: Db): Promise<number> {
  return db.profilePhoto.count({ where: { moderation: "PENDING" } });
}

/**
 * The human decision, PENDING → APPROVED or REJECTED.
 *
 * Concurrency: the row is locked, then its state is re-read inside the transaction. A photo that is no longer
 * PENDING — because another reviewer decided it, or because this browser tab was holding a stale queue — is
 * refused with a message naming the decision that already stands. Deciding is therefore never idempotent by
 * accident: an approval cannot quietly undo somebody else's rejection.
 */
export async function decidePhoto(
  admin: AdminActor,
  photoId: string,
  input: unknown,
  deps: { db?: Db; now?: Date } = {},
): Promise<{ photoId: string; moderation: PhotoDecision; userId: string }> {
  assertPermission(admin, "photos.moderate");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the decision");
  const { decision, reason } = parsed.data;
  if (decision === "REJECTED" && reason.trim().length < 3) throw new ValidationError("Say why the photo was rejected");

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "ProfilePhoto" WHERE id = ${photoId} FOR UPDATE`;
    const photo = await tx.profilePhoto.findUnique({
      where: { id: photoId },
      select: { id: true, moderation: true, position: true, profile: { select: { userId: true } } },
    });
    if (!photo) throw new NotFoundError("Photo");
    const ownerId = photo.profile.userId;
    if (ownerId === admin.userId) throw new InvalidStateError("You can't moderate your own photo");
    if (photo.moderation !== "PENDING") {
      throw new InvalidStateError(
        photo.moderation === "APPROVED"
          ? "This photo has already been approved. Reload the queue."
          : "This photo has already been rejected. Reload the queue.",
      );
    }
    await tx.profilePhoto.update({ where: { id: photoId }, data: { moderation: decision } });
    await writeAudit(tx, {
      actorId: admin.userId,
      action: AUDIT_ACTIONS.photoModerated,
      targetType: "ProfilePhoto",
      targetId: photoId,
      data: {
        userId: ownerId,
        position: photo.position,
        reason: reason.trim() || null,
        before: { moderation: photo.moderation },
        after: { moderation: decision },
      },
      now,
    });
    return { photoId, moderation: decision, userId: ownerId };
  });
}

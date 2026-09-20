/**
 * Public photo + Plus photo unlock — the ONE place that decides whose photos a viewer may receive
 * (docs/ARCHITECTURE.md §12.18).
 *
 *     canViewAllPhotos = isProfileOwner || viewerHasPlus || viewerIsMatchedWith(owner)
 *
 * Everyone gets the owner's MAIN photo, which is what keeps the Free experience usable: you can see who somebody
 * is, read them, and decide to like them. Every other photo is protected until you match or upgrade.
 *
 * Two things this module is deliberately NOT:
 *
 *   - It is not a moderation decision. `displayablePhotoWhere()` has already removed anything PENDING or REJECTED
 *     before a photo reaches here, and nothing in this file can put one back. Plus buys access to photos the
 *     owner published, never to photos a reviewer has not cleared.
 *   - It is not a rendering concern. The lock is applied by withholding the storage keys in the read model, so a
 *     locked photo has no URL to sign and no URL to leak — not in HTML, not in an RSC payload, not in a network
 *     request. Blurring in CSS over the real image would be decoration, not protection.
 *
 * Performance: `resolvePhotoAccess` answers for a whole page of profiles in two queries — one entitlement lookup
 * for the viewer, one match lookup for all the targets at once — so a deck of cards costs the same as one card.
 */
import type { DbLike } from "@/lib/db";
import { getEntitlements } from "@/server/entitlements";

export interface PhotoAccess {
  /** True when this viewer may receive every displayable photo of the given member. */
  canSeeAll(targetUserId: string): boolean;
}

export async function resolvePhotoAccess(
  db: DbLike,
  viewerId: string,
  targetUserIds: string[],
  now: Date = new Date(),
): Promise<PhotoAccess> {
  const targets = [...new Set(targetUserIds)].filter((id) => id !== viewerId);
  if (targets.length === 0) {
    return { canSeeAll: (targetUserId) => targetUserId === viewerId };
  }

  const [entitlements, matches] = await Promise.all([
    getEntitlements(db, viewerId, now),
    // One query for the whole page. Only an ACTIVE match unlocks: unmatching puts the photos back behind the lock.
    db.match.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { userAId: viewerId, userBId: { in: targets } },
          { userBId: viewerId, userAId: { in: targets } },
        ],
      },
      select: { userAId: true, userBId: true },
    }),
  ]);

  const plus = entitlements.rules.canSeeProtectedPhotos;
  const matched = new Set<string>();
  for (const m of matches) matched.add(m.userAId === viewerId ? m.userBId : m.userAId);

  return {
    canSeeAll: (targetUserId) => targetUserId === viewerId || plus || matched.has(targetUserId),
  };
}

/** A photo the viewer may see in full: the keys are present, so a URL can be signed for it. */
export interface UnlockedPhoto {
  id: string;
  blurhash: string;
  width: number;
  height: number;
  storageKey: string;
  thumbKey: string;
  locked: false;
}

/**
 * A photo the viewer may NOT see. It carries no storage key by construction, so there is no URL to sign and
 * nothing to leak; the blurhash is the entire representation, which is the same thing Free viewers have always
 * received in Likes You. Dimensions stay so the grid can reserve the right shape.
 */
export interface LockedPhoto {
  id: string;
  blurhash: string;
  width: number;
  height: number;
  locked: true;
}

export type VisiblePhoto = UnlockedPhoto | LockedPhoto;

/**
 * Applies the rule to one member's already-moderation-filtered photos.
 *
 * `photos` must arrive ordered by position, so the first entry is the main/public one. That is the existing
 * primary-photo mechanism (`ProfilePhoto.position`, 0 = primary) rather than a second source of truth, which also
 * means every profile that already exists has a main photo without anybody re-uploading anything. When position 0
 * happens to be un-displayable the first photo that IS displayable becomes the public one, which falls out of
 * taking the first entry of an already-filtered list.
 */
export function applyPhotoLock(
  photos: { id: string; blurhash: string; width: number; height: number; storageKey: string; thumbKey: string }[],
  canSeeAll: boolean,
): VisiblePhoto[] {
  return photos.map((photo, index): VisiblePhoto => {
    if (canSeeAll || index === 0) return { ...photo, locked: false };
    // Destructured away, not blanked: what is never selected cannot be serialised by accident downstream.
    const { storageKey: _storageKey, thumbKey: _thumbKey, ...rest } = photo;
    return { ...rest, locked: true };
  });
}

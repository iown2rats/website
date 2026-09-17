/**
 * Photo visibility policy — the ONE place that decides which ProfilePhoto.moderation states other users may see
 * (Discover, expanded profiles, Likes You, match screen, chat headers, community surfaces).
 *
 *  - development / test: APPROVED and PENDING, because there is no moderation pipeline yet and freshly uploaded
 *    photos must be visible to develop against.
 *  - production: APPROVED only. PENDING is never exposed automatically; REJECTED (and any future disabled state)
 *    is never displayable anywhere.
 *
 * The policy is selected by PHOTO_VISIBILITY_POLICY (validated in src/lib/env.ts). Production accepts only
 * "approved-only": shipping PENDING photos to the public requires either a moderation/approval workflow or an
 * explicitly approved alternative policy encoded here as a new value, not an environment override.
 * Queries call these helpers; nothing else reads NODE_ENV for photo decisions.
 */
import { getEnv } from "@/lib/env";

export type DisplayablePhotoState = "APPROVED" | "PENDING";
export type PhotoVisibilityPolicy = "approved-only" | "approved-and-pending";

const STATES: Record<PhotoVisibilityPolicy, readonly DisplayablePhotoState[]> = {
  "approved-only": ["APPROVED"],
  "approved-and-pending": ["APPROVED", "PENDING"],
};

export function getPhotoVisibilityPolicy(): PhotoVisibilityPolicy {
  return getEnv().PHOTO_VISIBILITY_POLICY;
}

/** Moderation states that may be shown to OTHER users under the active policy. */
export function displayablePhotoStates(): readonly DisplayablePhotoState[] {
  return STATES[getPhotoVisibilityPolicy()];
}

/** Prisma `where` fragment for photos other users may see. */
export function displayablePhotoWhere(): { moderation: { in: DisplayablePhotoState[] } } {
  return { moderation: { in: [...displayablePhotoStates()] } };
}

/**
 * Community media follows the same policy as profile photos (pending visible outside production, approved only in
 * production) but has its own moderation column (CommunityPost.photoModeration). A post whose photo is not
 * displayable is hidden from other users' feeds and shown only to its author as "under review".
 */
export function displayableCommunityMediaStates(): readonly DisplayablePhotoState[] {
  return displayablePhotoStates();
}

/**
 * The public DTO for another user's profile (docs/ARCHITECTURE.md §7).
 * Contains no phone, DOB, email, coordinates, internal ids or privacy flags.
 */
import type { DbLike } from "@/lib/db";
import { displayablePhotoWhere } from "@/lib/photo-policy";
import { ageFromDateOfBirth } from "@/lib/age";
import { applyPhotoLock, resolvePhotoAccess, type VisiblePhoto } from "@/server/photos/visibility";
import { datingFieldsApply } from "@/server/preferences/intent-policy";

/**
 * A photo as this viewer is allowed to receive it (docs/ARCHITECTURE.md §12.18). An unlocked photo carries its
 * storage keys; a locked one carries none, so nothing downstream can sign a URL for it.
 */
export type VisibleProfilePhoto = VisiblePhoto;

export interface VisibleProfile {
  handle: string;
  name: string;
  /** Null when the user hides their age. */
  age: number | null;
  /** Island / city / atoll label, or null when hidden. */
  location: string | null;
  verified: boolean;
  occupation: string | null;
  education: string | null;
  languages: string[];
  heightCm: number | null;
  bio: string | null;
  /** The member's Dating answer ("Looking for …"). Always null for a Friendship member, whatever is stored. */
  intent: string | null;
  interests: string[];
  prompts: { prompt: string; answer: string }[];
  photos: VisibleProfilePhoto[];
  /** Photos this viewer cannot see yet. Lets a surface say "3 more photos" without shipping them. */
  lockedPhotoCount: number;
  /** Null when the user hides active status. */
  isActiveNow: boolean | null;
  /** Internal id, kept server-side only for follow-up actions; actions accept handles from clients. */
  userId: string;
}

const ACTIVE_NOW_MS = 15 * 60_000;

/**
 * Hydrates DTOs for ids that have ALREADY passed the visibility predicate, preserving input order.
 *
 * The `accountType` filter is the last line of defence (docs/ARCHITECTURE.md §22.5): every caller is supposed to
 * hand over ids the predicate already cleared, but this is the one function that turns an id into something a
 * member actually sees. Filtering here means an operational account cannot be rendered as a dating profile even
 * if an id reaches this point some other way — the row is simply dropped from the result.
 */
export async function buildVisibleProfiles(db: DbLike, viewerId: string, userIds: string[], now: Date): Promise<VisibleProfile[]> {
  if (userIds.length === 0) return [];
  /*
   * Whose photos this viewer may have in full. Two queries for the whole page — one entitlement lookup, one match
   * lookup — so a deck of cards costs what a single card costs. The lock is applied HERE, at the one function
   * that turns an id into something a member sees, which is why no surface downstream can leak a protected photo:
   * it never receives the key.
   */
  const access = await resolvePhotoAccess(db, viewerId, userIds, now);
  const users = await db.user.findMany({
    where: { id: { in: userIds }, accountType: "MEMBER" },
    select: {
      id: true,
      dateOfBirth: true,
      lastActiveAt: true,
      privacy: { select: { hideAge: true, hideLocation: true, hideActiveStatus: true } },
      verification: { select: { status: true } },
      discoveryPreferences: { select: { connectionIntent: true } },
      profile: {
        select: {
          handle: true,
          displayName: true,
          bio: true,
          occupation: true,
          education: true,
          languages: true,
          heightCm: true,
          intent: true,
          location: { select: { name: true } },
          interests: { select: { interest: { select: { label: true } } } },
          prompts: { orderBy: { position: "asc" }, select: { answer: true, prompt: { select: { text: true } } } },
          photos: {
            where: displayablePhotoWhere(),
            orderBy: { position: "asc" },
            select: { id: true, blurhash: true, width: true, height: true, storageKey: true, thumbKey: true },
          },
        },
      },
    },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const out: VisibleProfile[] = [];
  for (const id of userIds) {
    const u = byId.get(id);
    if (!u?.profile) continue;
    const p = u.profile;
    const photos = applyPhotoLock(p.photos, access.canSeeAll(u.id));
    out.push({
      handle: p.handle,
      name: p.displayName,
      age: u.privacy?.hideAge || !u.dateOfBirth ? null : ageFromDateOfBirth(u.dateOfBirth, now),
      location: u.privacy?.hideLocation ? null : (p.location?.name ?? null),
      verified: u.verification?.status === "VERIFIED",
      occupation: p.occupation,
      education: p.education,
      languages: p.languages,
      heightCm: p.heightCm,
      bio: p.bio,
      // Dating only (src/server/preferences/intent-policy.ts `datingFieldsApply`). A Friendship member keeps a stored
      // dating answer for a switch back, but it is theirs to keep, not anybody's to read: no card, full profile, Likes
      // You tile or match screen is sent it, because every one of them is built here.
      intent: datingFieldsApply(u.discoveryPreferences?.connectionIntent ?? "DATING") ? p.intent : null,
      interests: p.interests.map((i) => i.interest.label),
      prompts: p.prompts.map((pr) => ({ prompt: pr.prompt.text, answer: pr.answer })),
      photos,
      lockedPhotoCount: photos.filter((ph) => ph.locked).length,
      isActiveNow: u.privacy?.hideActiveStatus
        ? null
        : Boolean(u.lastActiveAt && now.getTime() - u.lastActiveAt.getTime() < ACTIVE_NOW_MS),
      userId: u.id,
    });
  }
  return out;
}

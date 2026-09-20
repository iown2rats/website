/**
 * The public DTO for another user's profile (docs/ARCHITECTURE.md §7).
 * Contains no phone, DOB, email, coordinates, internal ids or privacy flags.
 */
import type { DbLike } from "@/lib/db";
import { displayablePhotoWhere } from "@/lib/photo-policy";
import { ageFromDateOfBirth } from "@/lib/age";

export interface VisibleProfilePhoto {
  id: string;
  blurhash: string;
  width: number;
  height: number;
  /** Storage key is resolved to a short-lived signed URL by the storage layer at render time. */
  storageKey: string;
  thumbKey: string;
}

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
  intent: string | null;
  interests: string[];
  prompts: { prompt: string; answer: string }[];
  photos: VisibleProfilePhoto[];
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
export async function buildVisibleProfiles(db: DbLike, _viewerId: string, userIds: string[], now: Date): Promise<VisibleProfile[]> {
  if (userIds.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: userIds }, accountType: "MEMBER" },
    select: {
      id: true,
      dateOfBirth: true,
      lastActiveAt: true,
      privacy: { select: { hideAge: true, hideLocation: true, hideActiveStatus: true } },
      verification: { select: { status: true } },
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
      intent: p.intent,
      interests: p.interests.map((i) => i.interest.label),
      prompts: p.prompts.map((pr) => ({ prompt: pr.prompt.text, answer: pr.answer })),
      photos: p.photos,
      isActiveNow: u.privacy?.hideActiveStatus
        ? null
        : Boolean(u.lastActiveAt && now.getTime() - u.lastActiveAt.getTime() < ACTIVE_NOW_MS),
      userId: u.id,
    });
  }
  return out;
}

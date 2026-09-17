/**
 * The safe, explicit shape a discovery card carries to the browser (docs/ARCHITECTURE.md §7.2).
 * Built only from VisibleProfile (already privacy-filtered) plus signed photo URLs. It never contains the
 * database id, phone, DOB, storage keys, privacy flags, moderation state, subscription or verification evidence.
 */
import { DISCOVERY } from "@/config/product";
import type { DbLike } from "@/lib/db";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import { buildVisibleProfiles, type VisibleProfile } from "@/server/profiles/visible-profile";

export interface DiscoveryPhotoDto {
  /** Signed, short-lived URL of the 1080-wide variant. Null only for development demo placeholders. */
  url: string | null;
  /** Signed URL of the 400-wide variant, used for next-card previews and avatars. */
  thumbUrl: string | null;
  /** Development demo placeholder key (renders as a gradient). Never set for real photos. */
  demoKey: string | null;
  blurhash: string;
  width: number;
  height: number;
}

export interface DiscoveryCardDto {
  /** Opaque public identifier. Actions accept this, never the database id. */
  handle: string;
  name: string;
  age: number | null;
  verified: boolean;
  location: string | null;
  occupation: string | null;
  education: string | null;
  languages: string[];
  heightCm: number | null;
  bio: string | null;
  intent: string | null;
  interests: string[];
  prompts: { prompt: string; answer: string }[];
  photos: DiscoveryPhotoDto[];
  isActiveNow: boolean | null;
}

/** Exhaustive allow-list; the DTO audit test asserts a card has exactly these keys. */
export const DISCOVERY_CARD_KEYS: readonly (keyof DiscoveryCardDto)[] = [
  "handle", "name", "age", "verified", "location", "occupation", "education", "languages", "heightCm", "bio", "intent", "interests", "prompts", "photos", "isActiveNow",
];

export const isDemoKey = (key: string) => key.startsWith("demo/");

export async function toDiscoveryCard(profile: VisibleProfile, storage: StorageProvider): Promise<DiscoveryCardDto> {
  const photos = await Promise.all(
    profile.photos.map(async (ph): Promise<DiscoveryPhotoDto> => {
      if (isDemoKey(ph.storageKey)) return { url: null, thumbUrl: null, demoKey: ph.storageKey, blurhash: ph.blurhash, width: ph.width, height: ph.height };
      const [url, thumbUrl] = await Promise.all([storage.getReadUrl(ph.storageKey, PHOTO_URL_TTL_SECONDS), storage.getReadUrl(ph.thumbKey, PHOTO_URL_TTL_SECONDS)]);
      return { url, thumbUrl, demoKey: null, blurhash: ph.blurhash, width: ph.width, height: ph.height };
    }),
  );
  return {
    handle: profile.handle,
    name: profile.name,
    age: profile.age,
    verified: profile.verified,
    location: profile.location,
    occupation: profile.occupation,
    education: profile.education,
    languages: profile.languages,
    heightCm: profile.heightCm,
    bio: profile.bio,
    intent: profile.intent,
    interests: profile.interests,
    prompts: profile.prompts,
    photos,
    isActiveNow: profile.isActiveNow,
  };
}

/**
 * Hydrates cards for ids that have ALREADY passed the deck predicate, preserving order. One query for all ids.
 * `requireMinPhotos` (default true) drops profiles whose displayable photos fell below the discovery minimum
 * between query and hydration; matched conversations pass false because a match stays a match.
 */
export async function buildDiscoveryCards(db: DbLike, viewerId: string, userIds: string[], now: Date, storage: StorageProvider, options: { requireMinPhotos?: boolean } = {}): Promise<DiscoveryCardDto[]> {
  const profiles = await buildVisibleProfiles(db, viewerId, userIds, now);
  const cards = await Promise.all(profiles.map((p) => toDiscoveryCard(p, storage)));
  if (options.requireMinPhotos === false) return cards;
  return cards.filter((c) => c.photos.length >= DISCOVERY.minDisplayablePhotos);
}

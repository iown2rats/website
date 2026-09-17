import type { PhotoRef } from "@/lib/photos";
import type { DiscoveryCardDto } from "@/server/discovery/dto";

/** What the deck card needs. Development fixtures satisfy this shape; production cards extend it. */
export interface CardProfile {
  id: string;
  handle: string;
  name: string;
  age: number | null;
  verified: boolean;
  location: string | null;
  occupation: string | null;
  intent: string | null;
  interests: string[];
  photos: PhotoRef[];
}

/** A production discovery card: the safe DTO reshaped for the deck, full profile and match screen. */
export interface DeckCard extends CardProfile {
  bio: string | null;
  education: string | null;
  languages: string[];
  heightCm: number | null;
  prompts: { prompt: string; answer: string }[];
  isActiveNow: boolean | null;
}

export function toDeckCard(dto: DiscoveryCardDto): DeckCard {
  return {
    id: dto.handle,
    handle: dto.handle,
    name: dto.name,
    age: dto.age,
    verified: dto.verified,
    location: dto.location,
    occupation: dto.occupation,
    intent: dto.intent,
    interests: dto.interests,
    photos: dto.photos.map((p, i) => ({ url: p.url, thumbUrl: p.thumbUrl, key: p.demoKey, blurhash: p.blurhash, alt: `${dto.name}, photo ${i + 1}` })),
    bio: dto.bio,
    education: dto.education,
    languages: dto.languages,
    heightCm: dto.heightCm,
    prompts: dto.prompts,
    isActiveNow: dto.isActiveNow,
  };
}

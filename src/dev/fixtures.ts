/**
 * Development fixtures derived from the prototype demo data. Never imported by production code paths:
 * callers must guard with `isDevelopment`.
 */
import { DEMO_CHATS, DEMO_LIKES_YOU, DEMO_MATCHES, DEMO_PROFILES, blurhashFor } from "../../prisma/seed-data/demo";
import type { CardProfile } from "@/components/features/discovery/types";
import type { PhotoRef } from "@/lib/photos";

const LOCATION_LABELS: Record<string, string> = {
  male: "Malé",
  hulhumale: "Hulhumalé",
  vilimale: "Vilimalé",
  "addu-city": "Addu City",
  fuvahmulah: "Fuvahmulah",
  "atoll-b": "B. Atoll",
  "atoll-hdh": "HDh. Atoll",
};

function photosFor(key: string, hues: number[], name: string): PhotoRef[] {
  return hues.map((h, i) => ({ key: `demo/${key}/${i}.hue-${h}`, blurhash: blurhashFor(h), alt: `${name}, photo ${i + 1}` }));
}

export const FIXTURE_CARDS: CardProfile[] = DEMO_PROFILES.filter((p) => p.key !== "me").map((p) => ({
  id: p.key,
  handle: `${p.name.toLowerCase()}-${p.key}`,
  name: p.name,
  age: p.age,
  verified: p.verified,
  location: LOCATION_LABELS[p.location] ?? p.location,
  occupation: p.occupation,
  intent: p.intent,
  interests: p.interests,
  photos: photosFor(p.key, p.hues, p.name),
}));

export const FIXTURE_ME = (() => {
  const me = DEMO_PROFILES.find((p) => p.key === "me")!;
  return {
    name: me.name,
    age: me.age,
    location: LOCATION_LABELS[me.location] ?? me.location,
    occupation: me.occupation,
    verified: me.verified,
    photo: photosFor("me", me.hues, me.name)[0]!,
    completion: 75,
  };
})();

export const FIXTURE_BADGES = {
  likes: DEMO_LIKES_YOU.length,
  chats: Object.entries(DEMO_CHATS).reduce((n, [key, msgs]) => (key === "p1" ? n : n + msgs.filter(([who]) => who === "them").length), 0),
};

export const FIXTURE_NEW_MATCHES = DEMO_MATCHES.map((k) => FIXTURE_CARDS.find((c) => c.id === k)!);

export const FIXTURE_ACTIVITY = [
  { name: "Hassan", text: "liked you", time: "12 min ago", photo: FIXTURE_CARDS.find((c) => c.id === "p2")!.photos[0]! },
  { name: "Ibrahim", text: "sent a message", time: "1 h ago", photo: FIXTURE_CARDS.find((c) => c.id === "p4")!.photos[0]! },
  { name: "Zara", text: "liked you", time: "Yesterday", photo: FIXTURE_CARDS.find((c) => c.id === "p9")!.photos[0]! },
];

import type { PhotoRef } from "@/lib/photos";

/** What the deck card needs. Built from VisibleProfile in later phases; from fixtures in Phase 4. */
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

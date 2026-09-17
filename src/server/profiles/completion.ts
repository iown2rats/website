/**
 * Profile completion — the single definition of what is required to finish onboarding and what merely
 * enriches a profile (Phase 5 §20). Consumed by onboarding completion, the Profile tab and suggestions.
 */
import { PHOTO_LIMITS } from "@/config/product";

export interface CompletionInput {
  hasName: boolean;
  hasDob: boolean;
  hasGender: boolean;
  hasInterestedIn: boolean;
  hasIntent: boolean;
  hasLocation: boolean;
  /** Photos that are not rejected. */
  activePhotoCount: number;
  hasBio: boolean;
  interestCount: number;
  promptCount: number;
  verified: boolean;
}

export interface CompletionResult {
  /** 0–100 */
  percent: number;
  /** All required fields present: the user may enter Discover. */
  requiredComplete: boolean;
  missingRequired: RequiredField[];
  suggestions: Suggestion[];
}

export type RequiredField = "name" | "dob" | "gender" | "interestedIn" | "intent" | "location" | "photos";

export interface Suggestion {
  key: "prompt" | "verify" | "interests" | "photo" | "bio";
  label: string;
  points: number;
}

/** Weights sum to 100. Required core = 40, photos = 15, bio = 10, interests = 10, prompts = 10, verification = 15. */
const WEIGHTS = {
  core: 8, // × 5 fields
  photosMin: 8,
  photosThird: 4,
  photosFifth: 3,
  bio: 10,
  interests: 10,
  prompt: 10,
  verified: 15,
} as const;

export const REQUIRED_PHOTO_COUNT = PHOTO_LIMITS.min;
export const INTERESTS_FOR_CREDIT = 3;

export function computeCompletion(i: CompletionInput): CompletionResult {
  const missingRequired: RequiredField[] = [];
  if (!i.hasName) missingRequired.push("name");
  if (!i.hasDob) missingRequired.push("dob");
  if (!i.hasGender) missingRequired.push("gender");
  if (!i.hasInterestedIn) missingRequired.push("interestedIn");
  if (!i.hasIntent) missingRequired.push("intent");
  if (!i.hasLocation) missingRequired.push("location");
  if (i.activePhotoCount < REQUIRED_PHOTO_COUNT) missingRequired.push("photos");

  let percent = 0;
  for (const has of [i.hasName, i.hasDob, i.hasGender, i.hasIntent, i.hasLocation]) if (has) percent += WEIGHTS.core;
  if (i.activePhotoCount >= REQUIRED_PHOTO_COUNT) percent += WEIGHTS.photosMin;
  if (i.activePhotoCount >= 3) percent += WEIGHTS.photosThird;
  if (i.activePhotoCount >= 5) percent += WEIGHTS.photosFifth;
  if (i.hasBio) percent += WEIGHTS.bio;
  if (i.interestCount >= INTERESTS_FOR_CREDIT) percent += WEIGHTS.interests;
  if (i.promptCount >= 1) percent += WEIGHTS.prompt;
  if (i.verified) percent += WEIGHTS.verified;

  const suggestions: Suggestion[] = [];
  if (i.promptCount === 0) suggestions.push({ key: "prompt", label: "Answer a profile prompt", points: WEIGHTS.prompt });
  if (!i.verified) suggestions.push({ key: "verify", label: "Verify your profile", points: WEIGHTS.verified });
  if (i.interestCount < INTERESTS_FOR_CREDIT) suggestions.push({ key: "interests", label: "Add interests", points: WEIGHTS.interests });
  if (!i.hasBio) suggestions.push({ key: "bio", label: "Write a short bio", points: WEIGHTS.bio });
  if (i.activePhotoCount < PHOTO_LIMITS.max && i.activePhotoCount < 5) {
    suggestions.push({ key: "photo", label: "Add another photo", points: i.activePhotoCount < 3 ? WEIGHTS.photosThird : WEIGHTS.photosFifth });
  }

  return { percent: Math.min(100, percent), requiredComplete: missingRequired.length === 0, missingRequired, suggestions };
}

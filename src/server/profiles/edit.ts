/**
 * Own-profile editing (Phase 9 §3–§8). Reuses the Phase 5 validation and save functions so onboarding and editing
 * share one rule set. The actor is always the session user; payloads never carry a user id. Name and date of birth
 * are read-only here (prototype: "Name and date of birth can't be changed after verification"); age is derived.
 */
import { getDb, type Db } from "@/lib/db";
import { ageFromDateOfBirth } from "@/lib/age";
import { InvalidStateError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { aboutEditSchema, infoSchema } from "@/lib/validation/profile";
import type { Actor } from "@/server/actor";
import { getOnboardingData } from "@/server/onboarding/onboarding";
import { saveAbout, saveIntent } from "@/server/onboarding/onboarding";
import { listPhotos, type PhotoDto } from "@/server/photos/photos";
import type { CompletionResult } from "./completion";

export interface EditProfileData {
  name: string;
  /** Owner-only. Never leaves the owner's own edit screen. */
  dob: { day: number; month: number; year: number } | null;
  age: number | null;
  gender: "WOMAN" | "MAN" | "UNSPECIFIED" | null;
  locationId: string | null;
  locationName: string | null;
  homeLocationId: string | null;
  homeLocationName: string | null;
  occupation: string;
  education: string;
  heightCm: number | null;
  bio: string;
  intent: "SERIOUS_RELATIONSHIP" | "DATING" | "MARRIAGE" | "FIGURING_OUT" | null;
  interestIds: string[];
  prompts: { promptId: string; answer: string }[];
  verified: boolean;
  photos: PhotoDto[];
  completion: CompletionResult;
}

function parse<T>(result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }): T {
  if (!result.success) throw new ValidationError(result.error.issues[0]?.message ?? "Please check your answer");
  return result.data;
}

export async function getEditProfileData(actor: Actor, deps: { db?: Db } = {}): Promise<EditProfileData> {
  const db = deps.db ?? getDb();
  const [user, data, photos] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: {
        dateOfBirth: true,
        profile: { select: { occupation: true, education: true, heightCm: true, homeLocationId: true, homeLocation: { select: { name: true } } } },
        verification: { select: { status: true } },
      },
    }),
    getOnboardingData(actor, { db }),
    listPhotos(actor, { db, storage: getStorageProvider() }),
  ]);
  return {
    name: data.name ?? "",
    dob: data.dob,
    age: user.dateOfBirth ? ageFromDateOfBirth(user.dateOfBirth) : null,
    gender: data.gender,
    locationId: data.locationId,
    locationName: data.locationName,
    homeLocationId: user.profile?.homeLocationId ?? null,
    homeLocationName: user.profile?.homeLocation?.name ?? null,
    occupation: user.profile?.occupation ?? "",
    education: user.profile?.education ?? "",
    heightCm: user.profile?.heightCm ?? null,
    bio: data.bio,
    intent: data.intent,
    interestIds: data.interestIds,
    prompts: data.prompts,
    verified: user.verification?.status === "VERIFIED",
    photos,
    completion: data.completion,
  };
}

/** Edit profile → Info: gender, location, optional home island, occupation, education, height. */
export async function updateInfo(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const info = parse(infoSchema.safeParse(input));
  const ids = [info.locationId, ...(info.homeLocationId ? [info.homeLocationId] : [])];
  const found = await db.location.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== new Set(ids).size) throw new ValidationError("Choose an island or atoll from the list");
  const profile = await db.profile.findUnique({ where: { userId: actor.userId }, select: { id: true } });
  if (!profile) throw new InvalidStateError("Add your name first");
  await db.$transaction([
    db.user.update({ where: { id: actor.userId }, data: { gender: info.gender } }),
    db.profile.update({
      where: { id: profile.id },
      data: { locationId: info.locationId, homeLocationId: info.homeLocationId, occupation: info.occupation || null, education: info.education || null, heightCm: info.heightCm },
    }),
  ]);
}

/** Edit profile → About / Interests / Prompts and relationship intention, through the onboarding save functions. */
export async function updateAbout(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const about = parse(aboutEditSchema.safeParse(input));
  await saveIntent(actor, { intent: about.intent }, { db });
  await saveAbout(actor, { bio: about.bio, interestIds: about.interestIds, prompts: about.prompts }, { db });
}

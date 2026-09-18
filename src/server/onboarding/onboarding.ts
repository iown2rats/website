/**
 * Onboarding domain (Phase 5 §6–§20). Each save validates its stage, persists immediately, and advances
 * the user's stage pointer when this stage is the furthest reached. Completion re-validates every
 * required field server-side before the account becomes ACTIVE.
 */
import type { Db, DbLike } from "@/lib/db";
import { getDb } from "@/lib/db";
import { InvalidStateError, ValidationError } from "@/lib/errors";
import { ageFromDateOfBirth, isAdult, MINIMUM_AGE } from "@/lib/age";
import { aboutSchema, dobSchema, genderSchema, intentSchema, locationSchema, meetSchema, nameSchema, privacySchema } from "@/lib/validation/onboarding";
import type { Actor } from "@/server/actor";
import { computeCompletion, type CompletionResult } from "@/server/profiles/completion";
import { generateHandle } from "@/server/users/account";
import { countActivePhotos } from "@/server/photos/photos";
import { hasReached, nextStage, stageIndex, type OnboardingStageKey, type StageOrComplete } from "./stages";

export interface OnboardingData {
  stage: StageOrComplete;
  name: string | null;
  dob: { day: number; month: number; year: number } | null;
  age: number | null;
  gender: "WOMAN" | "MAN" | "UNSPECIFIED" | null;
  interestedIn: "WOMEN" | "MEN" | "EVERYONE" | null;
  intent: "SERIOUS_RELATIONSHIP" | "DATING" | "MARRIAGE" | "FIGURING_OUT" | null;
  locationId: string | null;
  locationName: string | null;
  bio: string;
  interestIds: string[];
  prompts: { promptId: string; answer: string }[];
  privacy: { hideLocation: boolean; hideAge: boolean; blockContacts: boolean };
  activePhotoCount: number;
  completion: CompletionResult;
}

/** Everything the onboarding screens need to prefill and the layout needs to route. DOB is only ever returned to its owner. */
export async function getOnboardingData(actor: Actor, deps: { db?: Db } = {}): Promise<OnboardingData> {
  const db = deps.db ?? getDb();
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: {
      onboardingStage: true,
      dateOfBirth: true,
      gender: true,
      discoveryPreferences: { select: { interestedIn: true } },
      privacy: { select: { hideLocation: true, hideAge: true, blockContacts: true } },
      verification: { select: { status: true } },
      profile: {
        select: {
          displayName: true,
          bio: true,
          intent: true,
          locationId: true,
          location: { select: { name: true } },
          interests: { select: { interestId: true } },
          prompts: { orderBy: { position: "asc" }, select: { promptId: true, answer: true } },
        },
      },
    },
  });
  const activePhotoCount = await countActivePhotos(db, actor.userId);
  const reachedMeet = hasReached(user.onboardingStage, "INTENT"); // MEET saved means the pointer moved past it
  const dob = user.dateOfBirth;
  const completion = computeCompletion({
    hasName: Boolean(user.profile?.displayName),
    hasDob: Boolean(dob),
    hasGender: Boolean(user.gender),
    hasInterestedIn: reachedMeet,
    hasIntent: Boolean(user.profile?.intent),
    hasLocation: Boolean(user.profile?.locationId),
    activePhotoCount,
    hasBio: Boolean(user.profile?.bio),
    interestCount: user.profile?.interests.length ?? 0,
    promptCount: user.profile?.prompts.length ?? 0,
    verified: user.verification?.status === "VERIFIED",
  });
  return {
    stage: user.onboardingStage,
    name: user.profile?.displayName ?? null,
    dob: dob ? { day: dob.getUTCDate(), month: dob.getUTCMonth() + 1, year: dob.getUTCFullYear() } : null,
    age: dob ? ageFromDateOfBirth(dob) : null,
    gender: user.gender,
    interestedIn: reachedMeet ? (user.discoveryPreferences?.interestedIn ?? null) : null,
    intent: user.profile?.intent ?? null,
    locationId: user.profile?.locationId ?? null,
    locationName: user.profile?.location?.name ?? null,
    bio: user.profile?.bio ?? "",
    interestIds: user.profile?.interests.map((i) => i.interestId) ?? [],
    prompts: user.profile?.prompts ?? [],
    privacy: { hideLocation: user.privacy?.hideLocation ?? false, hideAge: user.privacy?.hideAge ?? false, blockContacts: user.privacy?.blockContacts ?? false },
    activePhotoCount,
    completion,
  };
}

/**
 * Moves the stage pointer forward when `from` was the furthest stage reached. The pointer never becomes
 * COMPLETE here: only completeOnboarding() sets it, after validating every required field.
 */
async function advance(db: DbLike, userId: string, from: OnboardingStageKey): Promise<void> {
  const target = nextStage(from);
  if (target === "COMPLETE") return;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardingStage: true } });
  if (stageIndex(user.onboardingStage) < stageIndex(target)) {
    await db.user.update({ where: { id: userId }, data: { onboardingStage: target } });
  }
}

function parse<T>(result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }): T {
  if (!result.success) throw new ValidationError(result.error.issues[0]?.message ?? "Please check your answer");
  return result.data;
}

export async function saveName(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const { name } = parse(nameSchema.safeParse(input));
  await db.profile.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, handle: generateHandle(), displayName: name },
    update: { displayName: name },
  });
  await advance(db, actor.userId, "NAME");
}

/** Server-side age gate: under 18 never persists; exactly 18 is allowed. */
export async function saveDateOfBirth(actor: Actor, input: unknown, deps: { db?: Db; now?: Date } = {}): Promise<{ age: number }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const { day, month, year } = parse(dobSchema.safeParse(input));
  const dob = new Date(Date.UTC(year, month - 1, day));
  if (dob.getTime() > now.getTime()) throw new ValidationError("That date is in the future");
  if (!isAdult(dob, now)) throw new ValidationError(`You must be ${MINIMUM_AGE} or older to use Mellocrush.`);
  await db.user.update({ where: { id: actor.userId }, data: { dateOfBirth: dob } });
  await advance(db, actor.userId, "DOB");
  return { age: ageFromDateOfBirth(dob, now) };
}

export async function saveGender(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const { gender } = parse(genderSchema.safeParse(input));
  await db.user.update({ where: { id: actor.userId }, data: { gender } });
  await advance(db, actor.userId, "GENDER");
}

export async function saveInterestedIn(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const { interestedIn } = parse(meetSchema.safeParse(input));
  await db.discoveryPreferences.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId, interestedIn }, update: { interestedIn } });
  await advance(db, actor.userId, "MEET");
}

export async function saveIntent(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const { intent } = parse(intentSchema.safeParse(input));
  const updated = await db.profile.updateMany({ where: { userId: actor.userId }, data: { intent } });
  if (updated.count === 0) throw new InvalidStateError("Add your name first");
  await advance(db, actor.userId, "INTENT");
}

export async function saveLocation(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const { locationId } = parse(locationSchema.safeParse(input));
  const location = await db.location.findUnique({ where: { id: locationId }, select: { id: true } });
  if (!location) throw new ValidationError("Choose an island or atoll from the list");
  const updated = await db.profile.updateMany({ where: { userId: actor.userId }, data: { locationId } });
  if (updated.count === 0) throw new InvalidStateError("Add your name first");
  await advance(db, actor.userId, "LOCATION");
}

/** Photos are uploaded through the photo API; this confirms the minimum and advances. */
export async function confirmPhotos(actor: Actor, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const count = await countActivePhotos(db, actor.userId);
  if (count < 2) throw new ValidationError("Add at least 2 photos to continue.");
  await advance(db, actor.userId, "PHOTOS");
}

export async function saveAbout(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const { bio, interestIds, prompts } = parse(aboutSchema.safeParse(input));
  const profile = await db.profile.findUnique({ where: { userId: actor.userId }, select: { id: true } });
  if (!profile) throw new InvalidStateError("Add your name first");

  const uniqueInterests = [...new Set(interestIds)];
  const validInterests = await db.interest.findMany({ where: { id: { in: uniqueInterests } }, select: { id: true } });
  if (validInterests.length !== uniqueInterests.length) throw new ValidationError("Choose interests from the list");
  const promptIds = [...new Set(prompts.map((p) => p.promptId))];
  if (promptIds.length !== prompts.length) throw new ValidationError("Each prompt can only be answered once");
  const validPrompts = await db.prompt.findMany({ where: { id: { in: promptIds }, active: true }, select: { id: true } });
  if (validPrompts.length !== promptIds.length) throw new ValidationError("Choose prompts from the list");

  await db.$transaction(async (tx) => {
    await tx.profile.update({ where: { id: profile.id }, data: { bio: bio || null } });
    await tx.profileInterest.deleteMany({ where: { profileId: profile.id } });
    if (uniqueInterests.length) await tx.profileInterest.createMany({ data: uniqueInterests.map((interestId) => ({ profileId: profile.id, interestId })) });
    await tx.profilePrompt.deleteMany({ where: { profileId: profile.id } });
    if (prompts.length) await tx.profilePrompt.createMany({ data: prompts.map((p, i) => ({ profileId: profile.id, promptId: p.promptId, answer: p.answer, position: i })) });
  });
  await advance(db, actor.userId, "ABOUT");
}

export async function savePrivacy(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const { hideLocation, hideAge, blockContacts } = parse(privacySchema.safeParse(input));
  await db.privacySettings.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, hideLocation, hideAge, blockContacts },
    update: { hideLocation, hideAge, blockContacts },
  });
  await advance(db, actor.userId, "PRIVACY");
}

/** Final gate. Re-checks every required field and the age rule; only then does the account become ACTIVE. */
export async function completeOnboarding(actor: Actor, deps: { db?: Db; now?: Date } = {}): Promise<CompletionResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const data = await getOnboardingData(actor, { db });
  if (!data.completion.requiredComplete) throw new ValidationError(`Please finish: ${data.completion.missingRequired.join(", ")}`);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { dateOfBirth: true, status: true, onboardingCompletedAt: true } });
  if (!user.dateOfBirth || !isAdult(user.dateOfBirth, now)) throw new ValidationError(`You must be ${MINIMUM_AGE} or older to use Mellocrush.`);
  if (user.status !== "ONBOARDING" && user.status !== "ACTIVE") throw new InvalidStateError("This account can't be activated");
  await db.user.update({
    where: { id: actor.userId },
    data: { status: "ACTIVE", onboardingStage: "COMPLETE", onboardingCompletedAt: user.onboardingCompletedAt ?? now },
  });
  return data.completion;
}

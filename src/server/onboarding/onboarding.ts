/**
 * Onboarding domain (Phase 5 §6–§20). Each save validates its stage, persists immediately, and advances
 * the user's stage pointer when this stage is the furthest reached. Completion re-validates every
 * required field server-side before the account becomes ACTIVE.
 */
import type { Db, DbLike } from "@/lib/db";
import { getDb } from "@/lib/db";
import { InvalidStateError, ValidationError } from "@/lib/errors";
import { ageFromDateOfBirth, isAdult, MINIMUM_AGE } from "@/lib/age";
import { aboutSchema, connectionSchema, dobSchema, genderSchema, intentSchema, locationSchema, nameSchema, privacySchema } from "@/lib/validation/onboarding";
import type { Actor } from "@/server/actor";
import { computeCompletion, type CompletionResult } from "@/server/profiles/completion";
import { generateHandle } from "@/server/users/account";
import { countActivePhotos } from "@/server/photos/photos";
import { assertGenderFitsIntent, assertGenderSelectable, assertPoolAllowed, parseConnectionIntent, type ConnectionIntent } from "@/server/preferences/intent-policy";
import { DEFAULT_AGE_PREFERENCES } from "@/server/preferences/defaults";
import { effectiveStage, hasReached, nextStage, stageIndex, type OnboardingStageKey, type StageOrComplete } from "./stages";

export interface OnboardingData {
  stage: StageOrComplete;
  name: string | null;
  dob: { day: number; month: number; year: number } | null;
  age: number | null;
  gender: "WOMAN" | "MAN" | "UNSPECIFIED" | null;
  connectionIntent: ConnectionIntent | null;
  intent: "SERIOUS_RELATIONSHIP" | "DATING" | "MARRIAGE" | "FIGURING_OUT" | null;
  locationId: string | null;
  locationName: string | null;
  bio: string;
  interestIds: string[];
  prompts: { promptId: string; answer: string }[];
  privacy: { hideLocation: boolean; hideAge: boolean };
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
      discoveryPreferences: { select: { connectionIntent: true } },
      privacy: { select: { hideLocation: true, hideAge: true } },
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
  // The pointer moves past CONNECTION only once an intent is saved, so anything earlier has not chosen one yet.
  const chosenIntent = hasReached(user.onboardingStage, "MEET") ? (user.discoveryPreferences?.connectionIntent ?? null) : null;
  // A stored pointer that is not on this member's path (MEET, which no path asks any more) reads as the next stage
  // that is, so resuming, routing and completion all agree and nobody is parked on a removed question.
  const stage = effectiveStage(user.onboardingStage, chosenIntent);
  /*
   * Who a member is shown follows from gender and pool, so choosing the pool IS the whole answer: there is no
   * "who would you like to meet" left to be missing once the intent is saved.
   *
   * Friendship is not asked INTENT ("how serious?") either. `Profile.intent` is written only by that stage, so a
   * skipped question counts as answered once the stage that would have asked it is behind them — without this,
   * every Friendship member reached the last screen and was told "Please finish: intent" with no screen left that
   * could set it.
   */
  const reachedMeet = chosenIntent !== null;
  const reachedIntent = chosenIntent === "FRIENDSHIP" ? hasReached(stage, "LOCATION") : Boolean(user.profile?.intent);
  const dob = user.dateOfBirth;
  const completion = computeCompletion({
    hasName: Boolean(user.profile?.displayName),
    hasDob: Boolean(dob),
    hasGender: Boolean(user.gender),
    hasInterestedIn: reachedMeet,
    hasIntent: reachedIntent,
    hasLocation: Boolean(user.profile?.locationId),
    activePhotoCount,
    hasBio: Boolean(user.profile?.bio),
    interestCount: user.profile?.interests.length ?? 0,
    promptCount: user.profile?.prompts.length ?? 0,
    verified: user.verification?.status === "VERIFIED",
  });
  return {
    stage,
    name: user.profile?.displayName ?? null,
    dob: dob ? { day: dob.getUTCDate(), month: dob.getUTCMonth() + 1, year: dob.getUTCFullYear() } : null,
    age: dob ? ageFromDateOfBirth(dob) : null,
    gender: user.gender,
    connectionIntent: chosenIntent,
    intent: user.profile?.intent ?? null,
    locationId: user.profile?.locationId ?? null,
    locationName: user.profile?.location?.name ?? null,
    bio: user.profile?.bio ?? "",
    interestIds: user.profile?.interests.map((i) => i.interestId) ?? [],
    prompts: user.profile?.prompts ?? [],
    privacy: { hideLocation: user.privacy?.hideLocation ?? false, hideAge: user.privacy?.hideAge ?? false },
    activePhotoCount,
    completion,
  };
}

/**
 * Moves the stage pointer forward when `from` was the furthest stage reached. The pointer never becomes
 * COMPLETE here: only completeOnboarding() sets it, after validating every required field.
 */
async function advance(db: DbLike, userId: string, from: OnboardingStageKey): Promise<void> {
  const prefs = await db.discoveryPreferences.findUnique({ where: { userId }, select: { connectionIntent: true } });
  const target = nextStage(from, prefs?.connectionIntent ?? null);
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

/**
 * Gender, and the preference that follows from it.
 *
 * Who a member sees follows from gender and pool, so nothing else is written here: the stored legacy "Show me" is
 * never touched. A member who has not reached
 * the intent step yet has no preference row to reconcile, and the CONNECTION step will settle it.
 */
export async function saveGender(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const { gender } = parse(genderSchema.safeParse(input));
  const current = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { gender: true } });
  // Woman or Man for new answers; a legacy "Prefer not to say" may be kept, never newly chosen.
  assertGenderSelectable(gender, current.gender);
  await assertGenderFitsChosenIntent(db, actor.userId, gender);
  await db.user.update({ where: { id: actor.userId }, data: { gender } });
  await advance(db, actor.userId, "GENDER");
}

/**
 * A gender change may not strand a member in a Dating state that can never match (Dating is woman ↔ man). Only an
 * intent the member actually CHOSE counts: before the CONNECTION step the row's DATING is the column default, not an
 * answer, so the GENDER step itself is never refused — CONNECTION then refuses Dating for them instead.
 *
 * Only a CHANGE is refused. A member already in that state (it predates this rule) is not rewritten and is not
 * locked out of saving the rest of their Info; the Filters sheet explains Dating to them instead.
 */
export async function assertGenderFitsChosenIntent(db: DbLike, userId: string, gender: "WOMAN" | "MAN" | "UNSPECIFIED"): Promise<void> {
  const [user, prefs] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardingStage: true, gender: true } }),
    db.discoveryPreferences.findUnique({ where: { userId }, select: { connectionIntent: true } }),
  ]);
  if (!prefs || !hasReached(user.onboardingStage, "MEET") || user.gender === gender) return;
  assertGenderFitsIntent(gender, prefs.connectionIntent);
}

/**
 * The connection intent — the whole of "who will I see": Dating is opposite gender, Friendship everyone in the pool. Nothing
 * further is asked about it; Dating goes on to "how serious?", Friendship straight to location.
 */
export async function saveConnectionIntent(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const { connectionIntent } = parse(connectionSchema.safeParse(input));
  const intent = parseConnectionIntent(connectionIntent);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { gender: true } });
  assertPoolAllowed(user.gender, intent);
  // Only the pool is written. The legacy "Show me" columns keep their stored value (or the column default).
  await db.discoveryPreferences.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, connectionIntent: intent, ...DEFAULT_AGE_PREFERENCES },
    update: { connectionIntent: intent },
  });
  await advance(db, actor.userId, "CONNECTION");
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
  const { hideLocation, hideAge } = parse(privacySchema.safeParse(input));
  // `blockContacts` is deliberately neither read nor written. The step no longer offers it, so writing it would
  // mean silently clearing the stored value of the fourteen members who had switched it on, on their next pass
  // through this screen — a write nobody asked for, to settle a feature that no longer exists.
  await db.privacySettings.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, hideLocation, hideAge },
    update: { hideLocation, hideAge },
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

"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { isDomainError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { requireMember } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";
import {
  completeOnboarding,
  confirmPhotos,
  saveAbout,
  saveConnectionIntent,
  saveDateOfBirth,
  saveGender,
  saveIntent,
  saveInterestedIn,
  saveLocation,
  saveName,
  savePrivacy,
} from "@/server/onboarding/onboarding";
import { nextStage, slugForStage, type OnboardingStageKey } from "@/server/onboarding/stages";

/*
 * Onboarding server actions: derive the actor from the session, validate, persist, then move to the next
 * stage. Domain errors become field-level messages; anything else is a generic message.
 */
export interface StageFormState {
  error?: string;
}

function friendly(e: unknown): StageFormState {
  if (isDomainError(e)) return { error: e.message };
  return { error: "Something went wrong. Please try again." };
}

/**
 * Where to go after `stage`. The next stage depends on the connection intent, because Dating and Friendship each
 * skip the other's question, so it is read fresh rather than assumed — the CONNECTION step is precisely where it
 * has just changed.
 */
async function goNext(actor: Actor, stage: OnboardingStageKey): Promise<never> {
  const prefs = await getDb().discoveryPreferences.findUnique({
    where: { userId: actor.userId },
    select: { connectionIntent: true },
  });
  redirect(`${ROUTES.onboarding}/${slugForStage(nextStage(stage, prefs?.connectionIntent ?? null))}`);
}

export async function submitName(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await saveName(actor, { name: formData.get("name") });
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "NAME");
}

export async function submitDob(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await saveDateOfBirth(actor, { day: formData.get("day"), month: formData.get("month"), year: formData.get("year") });
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "DOB");
}

export async function submitGender(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await saveGender(actor, { gender: formData.get("gender") });
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "GENDER");
}

export async function submitConnectionIntent(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await saveConnectionIntent(actor, { connectionIntent: formData.get("connectionIntent") });
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "CONNECTION");
}

export async function submitMeet(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await saveInterestedIn(actor, { interestedIn: formData.get("interestedIn") });
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "MEET");
}

export async function submitIntent(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await saveIntent(actor, { intent: formData.get("intent") });
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "INTENT");
}

export async function submitLocation(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await saveLocation(actor, { locationId: formData.get("locationId") });
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "LOCATION");
}

export async function submitPhotos(): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await confirmPhotos(actor);
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "PHOTOS");
}

export async function submitAbout(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireMember();
  let prompts: unknown = [];
  try {
    prompts = JSON.parse(String(formData.get("prompts") ?? "[]"));
  } catch {
    return { error: "Please check your prompt answers." };
  }
  try {
    await saveAbout(actor, { bio: formData.get("bio") ?? "", interestIds: formData.getAll("interestIds").map(String), prompts });
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "ABOUT");
}

export async function submitPrivacy(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await savePrivacy(actor, {
      hideLocation: formData.get("hideLocation") === "on",
      hideAge: formData.get("hideAge") === "on",
      blockContacts: formData.get("blockContacts") === "on",
    });
  } catch (e) {
    return friendly(e);
  }
  return goNext(actor, "PRIVACY");
}

export async function submitComplete(): Promise<StageFormState> {
  const actor = await requireMember();
  try {
    await completeOnboarding(actor);
  } catch (e) {
    return friendly(e);
  }
  redirect(ROUTES.home);
}

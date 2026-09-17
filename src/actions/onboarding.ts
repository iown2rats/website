"use server";

import { redirect } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { requireActor } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";
import {
  completeOnboarding,
  confirmPhotos,
  saveAbout,
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

function goNext(stage: OnboardingStageKey): never {
  redirect(`${ROUTES.onboarding}/${slugForStage(nextStage(stage))}`);
}

export async function submitName(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireActor();
  try {
    await saveName(actor, { name: formData.get("name") });
  } catch (e) {
    return friendly(e);
  }
  goNext("NAME");
}

export async function submitDob(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireActor();
  try {
    await saveDateOfBirth(actor, { day: formData.get("day"), month: formData.get("month"), year: formData.get("year") });
  } catch (e) {
    return friendly(e);
  }
  goNext("DOB");
}

export async function submitGender(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireActor();
  try {
    await saveGender(actor, { gender: formData.get("gender") });
  } catch (e) {
    return friendly(e);
  }
  goNext("GENDER");
}

export async function submitMeet(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireActor();
  try {
    await saveInterestedIn(actor, { interestedIn: formData.get("interestedIn") });
  } catch (e) {
    return friendly(e);
  }
  goNext("MEET");
}

export async function submitIntent(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireActor();
  try {
    await saveIntent(actor, { intent: formData.get("intent") });
  } catch (e) {
    return friendly(e);
  }
  goNext("INTENT");
}

export async function submitLocation(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireActor();
  try {
    await saveLocation(actor, { locationId: formData.get("locationId") });
  } catch (e) {
    return friendly(e);
  }
  goNext("LOCATION");
}

export async function submitPhotos(): Promise<StageFormState> {
  const actor = await requireActor();
  try {
    await confirmPhotos(actor);
  } catch (e) {
    return friendly(e);
  }
  goNext("PHOTOS");
}

export async function submitAbout(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireActor();
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
  goNext("ABOUT");
}

export async function submitPrivacy(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  const actor = await requireActor();
  try {
    await savePrivacy(actor, {
      hideLocation: formData.get("hideLocation") === "on",
      hideAge: formData.get("hideAge") === "on",
      blockContacts: formData.get("blockContacts") === "on",
    });
  } catch (e) {
    return friendly(e);
  }
  goNext("PRIVACY");
}

export async function submitComplete(): Promise<StageFormState> {
  const actor = await requireActor();
  try {
    await completeOnboarding(actor);
  } catch (e) {
    return friendly(e);
  }
  redirect(ROUTES.home);
}

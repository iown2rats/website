"use server";

import { isDomainError } from "@/lib/errors";
import { requireActor } from "@/server/auth/current-user";
import { getEditProfileData, updateAbout, updateInfo, type EditProfileData } from "@/server/profiles/edit";

/*
 * Own-profile editing actions (Phase 9). The acting user is the session user; payloads are validated with the
 * shared onboarding/profile schemas, which strip unknown keys. Name and date of birth are not accepted here.
 */

export type ProfileActionFailure = { ok: false; code: "VALIDATION" | "UNAVAILABLE" | "ERROR"; message: string };

function failure(e: unknown): ProfileActionFailure {
  if (isDomainError(e)) {
    if (e.code === "VALIDATION") return { ok: false, code: "VALIDATION", message: e.message };
    if (e.code === "INVALID_STATE") return { ok: false, code: "UNAVAILABLE", message: e.message };
  }
  console.error("[profile] action failed", e);
  return { ok: false, code: "ERROR", message: "Mellocrush couldn't save that right now. Try again." };
}

export async function saveInfo(input: unknown): Promise<{ ok: true; profile: EditProfileData } | ProfileActionFailure> {
  try {
    const actor = await requireActor();
    await updateInfo(actor, input);
    return { ok: true, profile: await getEditProfileData(actor) };
  } catch (e) {
    return failure(e);
  }
}

export async function saveAboutSection(input: unknown): Promise<{ ok: true; profile: EditProfileData } | ProfileActionFailure> {
  try {
    const actor = await requireActor();
    await updateAbout(actor, input);
    return { ok: true, profile: await getEditProfileData(actor) };
  } catch (e) {
    return failure(e);
  }
}

export async function reloadEditProfile(): Promise<{ ok: true; profile: EditProfileData } | ProfileActionFailure> {
  try {
    const actor = await requireActor();
    return { ok: true, profile: await getEditProfileData(actor) };
  } catch (e) {
    return failure(e);
  }
}

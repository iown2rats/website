"use server";

import { z } from "zod";
import { isDomainError } from "@/lib/errors";
import { handleSchema } from "@/lib/validation/profile";
import { requireMember } from "@/server/auth/current-user";
import { getNotificationSettings, updateNotificationSettings, type NotificationSettingsDto } from "@/server/notifications/settings";
import { setInvisibleMode } from "@/server/privacy/invisible-mode";
import { getPrivacySettings, setDatingPaused, updatePrivacyToggles, type PrivacySettingsDto } from "@/server/privacy/settings";
import { listBlockedUsers, unblockUser, type BlockedUserDto } from "@/server/safety/blocked";

/*
 * Settings actions (Phase 9). Every write is scoped to the session user and validated server-side. Invisible Mode
 * goes through the entitlement-checked domain function: a Free client calling it directly is refused.
 */

export type SettingsFailure = { ok: false; code: "VALIDATION" | "ENTITLEMENT" | "NOT_FOUND" | "ERROR"; message: string };

function failure(e: unknown): SettingsFailure {
  if (isDomainError(e)) {
    if (e.code === "VALIDATION") return { ok: false, code: "VALIDATION", message: e.message };
    if (e.code === "ENTITLEMENT_REQUIRED") return { ok: false, code: "ENTITLEMENT", message: "Invisible Mode is part of Mellocrush Plus." };
    if (e.code === "NOT_FOUND") return { ok: false, code: "NOT_FOUND", message: "That's no longer available." };
    if (e.code === "INVALID_STATE") return { ok: false, code: "VALIDATION", message: e.message };
  }
  console.error("[settings] action failed", e);
  return { ok: false, code: "ERROR", message: "Mellocrush couldn't save that right now. Try again." };
}

type PrivacyResult = { ok: true; privacy: PrivacySettingsDto } | SettingsFailure;

export async function savePrivacyToggles(input: unknown): Promise<PrivacyResult> {
  try {
    const actor = await requireMember();
    return { ok: true, privacy: await updatePrivacyToggles(actor, input) };
  } catch (e) {
    return failure(e);
  }
}

export async function saveInvisibleMode(input: unknown): Promise<PrivacyResult> {
  try {
    const actor = await requireMember();
    const enabled = z.object({ enabled: z.boolean() }).parse(input).enabled;
    await setInvisibleMode(actor, enabled);
    return { ok: true, privacy: await getPrivacySettings(actor) };
  } catch (e) {
    return failure(e);
  }
}

export async function savePausedDating(input: unknown): Promise<PrivacyResult> {
  try {
    const actor = await requireMember();
    const paused = z.object({ paused: z.boolean() }).parse(input).paused;
    return { ok: true, privacy: await setDatingPaused(actor, paused) };
  } catch (e) {
    return failure(e);
  }
}

export async function saveNotificationSettings(input: unknown): Promise<{ ok: true; settings: NotificationSettingsDto } | SettingsFailure> {
  try {
    const actor = await requireMember();
    return { ok: true, settings: await updateNotificationSettings(actor, input) };
  } catch (e) {
    return failure(e);
  }
}

export async function loadNotificationSettings(): Promise<{ ok: true; settings: NotificationSettingsDto } | SettingsFailure> {
  try {
    const actor = await requireMember();
    return { ok: true, settings: await getNotificationSettings(actor) };
  } catch (e) {
    return failure(e);
  }
}

export async function unblock(input: unknown): Promise<{ ok: true; blocked: BlockedUserDto[] } | SettingsFailure> {
  try {
    const actor = await requireMember();
    const { handle } = handleSchema.parse(input);
    await unblockUser(actor, handle);
    return { ok: true, blocked: await listBlockedUsers(actor) };
  } catch (e) {
    return failure(e);
  }
}


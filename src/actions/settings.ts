"use server";

import { z } from "zod";
import { isDomainError } from "@/lib/errors";
import { handleSchema } from "@/lib/validation/profile";
import { requireMember } from "@/server/auth/current-user";
import { getPushState, registerPushDevice, unregisterAllPushDevices, unregisterPushDevice, type PushStateDto } from "@/server/notifications/devices";
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

// ───────────────────────────── Push devices ─────────────────────────────

type PushResult = { ok: true; push: PushStateDto } | SettingsFailure;

const endpointSchema = z.object({
  endpoint: z.string().min(1).max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
  userAgent: z.string().max(400).optional().nullable(),
});

/** What the client needs to decide whether to offer push: is it configured here, and how many devices are live. */
export async function loadPushState(): Promise<PushResult> {
  try {
    const actor = await requireMember();
    return { ok: true, push: await getPushState(actor) };
  } catch (e) {
    return failure(e);
  }
}

/** Registers this browser after the member grants permission. Upserts on the endpoint, so re-granting is not a duplicate. */
export async function savePushDevice(input: unknown): Promise<PushResult> {
  try {
    const actor = await requireMember();
    const parsed = endpointSchema.parse(input);
    return { ok: true, push: await registerPushDevice(actor, { endpoint: parsed.endpoint, keys: parsed.keys, userAgent: parsed.userAgent ?? null }) };
  } catch (e) {
    return failure(e);
  }
}

/** Forgets this browser. Scoped to the session user, so somebody else's endpoint is a silent no-op. */
export async function forgetPushDevice(input: unknown): Promise<PushResult> {
  try {
    const actor = await requireMember();
    const endpoint = z.object({ endpoint: z.string().min(1).max(2048) }).parse(input).endpoint;
    return { ok: true, push: await unregisterPushDevice(actor, endpoint) };
  } catch (e) {
    return failure(e);
  }
}

/** Turning push off everywhere: clears the preference AND forgets every device, so nothing can arrive after. */
export async function disablePushEverywhere(): Promise<{ ok: true; settings: NotificationSettingsDto; push: PushStateDto } | SettingsFailure> {
  try {
    const actor = await requireMember();
    const settings = await updateNotificationSettings(actor, { push: false });
    return { ok: true, settings, push: await unregisterAllPushDevices(actor) };
  } catch (e) {
    return failure(e);
  }
}

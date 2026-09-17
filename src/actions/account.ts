"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { isDomainError } from "@/lib/errors";
import { clearSessionCookie } from "@/lib/session-cookie";
import { getStorageProvider } from "@/lib/storage";
import { otpConfirmSchema } from "@/lib/validation/profile";
import { OTP_RULES } from "@/server/auth/otp";
import { requireActor } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";
import { getSmsProvider } from "@/server/auth/sms";
import { deleteAccount, requestDeletionCode } from "@/server/users/deletion";

/*
 * Destructive account actions (Phase 9 §25–§26). Deleting requires a fresh code sent to the account's own phone
 * through the same OTP rules and provider abstraction as sign-in (development: console provider + echo). The
 * challenge id is returned to the client for the confirm step; it carries no secret and is bound to this phone.
 */

export type DeletionRequestResult =
  | { ok: true; challengeId: string; expiresAt: number; resendAvailableAt: number; devCode?: string }
  | { ok: false; code: "COOLDOWN" | "RATE_LIMITED" | "SMS_FAILED" | "ERROR"; message: string; retryAt?: number };

export async function requestAccountDeletionCode(): Promise<DeletionRequestResult> {
  try {
    const actor = await requireActor();
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const r = await requestDeletionCode(actor, { sms: getSmsProvider(), ip });
    if (!r.ok) {
      if (r.code === "COOLDOWN") return { ok: false, code: "COOLDOWN", message: "We just sent you a code. Wait a moment before requesting another.", retryAt: r.retryAt?.getTime() };
      if (r.code === "RATE_LIMITED") return { ok: false, code: "RATE_LIMITED", message: "Too many codes requested. Try again later.", retryAt: r.retryAt?.getTime() };
      return { ok: false, code: "SMS_FAILED", message: "We couldn't send your code right now. Try again in a moment." };
    }
    return { ok: true, challengeId: r.challengeId, expiresAt: r.expiresAt.getTime(), resendAvailableAt: r.resendAvailableAt.getTime(), ...(r.devCode ? { devCode: r.devCode } : {}) };
  } catch (e) {
    console.error("[account] deletion code failed", e);
    return { ok: false, code: "ERROR", message: "Thundi couldn't do that right now. Try again." };
  }
}

export type DeletionConfirmResult = { ok: true } | { ok: false; code: "INVALID_CODE" | "CODE_EXPIRED" | "CODE_USED" | "TOO_MANY_ATTEMPTS" | "ERROR"; message: string; attemptsRemaining?: number };

export async function confirmAccountDeletion(input: unknown): Promise<DeletionConfirmResult> {
  let deleted = false;
  try {
    const actor = await requireActor();
    const parsed = otpConfirmSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "INVALID_CODE", message: "Enter the 6-digit code." };
    const r = await deleteAccount(actor, parsed.data, { storage: getStorageProvider(), db: getDb() });
    if (!r.ok) {
      const messages = {
        INVALID_CODE: r.attemptsRemaining != null ? `That code isn't right. ${r.attemptsRemaining} attempt${r.attemptsRemaining === 1 ? "" : "s"} left.` : "That code isn't right.",
        CODE_EXPIRED: `That code expired. Codes last ${OTP_RULES.ttlMs / 60_000} minutes — request a new one.`,
        CODE_USED: "That code was already used. Request a new one.",
        TOO_MANY_ATTEMPTS: "Too many attempts. Request a new code.",
      } as const;
      return { ok: false, code: r.code, message: messages[r.code], attemptsRemaining: r.attemptsRemaining };
    }
    deleted = true;
  } catch (e) {
    if (isDomainError(e)) return { ok: false, code: "INVALID_CODE", message: e.message };
    console.error("[account] deletion failed", e);
    return { ok: false, code: "ERROR", message: "Thundi couldn't delete your account right now. Try again." };
  }
  if (deleted) {
    await clearSessionCookie();
    redirect(ROUTES.welcome);
  }
  return { ok: true };
}

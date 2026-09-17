"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/lib/session-cookie";
import { clearOtpChallengeCookie, readOtpChallengeCookie, setOtpChallengeCookie } from "@/lib/otp-cookie";
import { requestOtp, verifyOtp } from "@/server/auth/otp";
import { formatLocalPhone } from "@/server/auth/phone";
import { ROUTES } from "@/server/auth/route-access";
import { revokeSession } from "@/server/auth/session";
import { getSmsProvider } from "@/server/auth/sms";

/*
 * Authentication server actions. Every response is generic about whether an account exists.
 * Errors are Thundi copy, never provider or database detail.
 */

export interface PhoneFormState {
  error?: string;
}

async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return { ip: forwarded ? forwarded.split(",")[0]!.trim() : (h.get("x-real-ip") ?? null), userAgent: h.get("user-agent") };
}

export async function submitPhone(_prev: PhoneFormState, formData: FormData): Promise<PhoneFormState> {
  const phoneInput = String(formData.get("phone") ?? "");
  const meta = await requestMeta();
  const result = await requestOtp(getDb(), { phoneInput, ip: meta.ip, sms: getSmsProvider() });
  if (!result.ok) {
    switch (result.code) {
      case "INVALID_PHONE":
        return { error: "Enter a Maldivian mobile number: 7 digits starting with 7 or 9." };
      case "COOLDOWN":
        return { error: "We just sent you a code. Wait a moment before requesting another." };
      case "RATE_LIMITED":
        return { error: "You've requested too many codes. Try again later." };
      case "SMS_FAILED":
        return { error: "We couldn't send your code right now. Try again in a moment." };
    }
  }
  await setOtpChallengeCookie({
    challengeId: result.challengeId,
    phoneLocal: formatLocalPhone(result.phoneE164),
    resendAvailableAt: result.resendAvailableAt.getTime(),
    expiresAt: result.expiresAt.getTime(),
    devCode: result.devCode,
  });
  redirect(ROUTES.verify);
}

export interface OtpFormState {
  error?: string;
  attemptsRemaining?: number;
  /** Set when the challenge is gone (expired/used/too many attempts) and the user must request a new code. */
  needsNewCode?: boolean;
}

export async function submitOtp(_prev: OtpFormState, formData: FormData): Promise<OtpFormState> {
  const challenge = await readOtpChallengeCookie();
  if (!challenge) return { error: "Your code has expired. Request a new one.", needsNewCode: true };
  const code = String(formData.get("code") ?? "");
  const meta = await requestMeta();
  const result = await verifyOtp(getDb(), { challengeId: challenge.challengeId, code, ip: meta.ip, userAgent: meta.userAgent });
  if (!result.ok) {
    // The challenge cookie is deliberately kept on terminal failures: the challenge is already dead on the
    // server, and the verify screen needs the cookie to stay rendered and show the "request a new code" state.
    switch (result.code) {
      case "INVALID_CODE":
        return { error: "That code isn't correct. Try again.", attemptsRemaining: result.attemptsRemaining };
      case "CODE_EXPIRED":
        return { error: "Your code has expired. Request a new one.", needsNewCode: true };
      case "CODE_USED":
        return { error: "That code has already been used. Request a new one.", needsNewCode: true };
      case "TOO_MANY_ATTEMPTS":
        return { error: "Too many attempts. Request a new code.", needsNewCode: true };
      case "ACCOUNT_UNAVAILABLE":
        return { error: "This account isn't available right now. Contact support if you think this is a mistake.", needsNewCode: true };
    }
  }
  await clearOtpChallengeCookie();
  await setSessionCookie(result.session.token, result.session.expiresAt);
  redirect(result.destination === "app" ? ROUTES.home : ROUTES.onboarding);
}

export interface ResendState {
  error?: string;
  resendAvailableAt?: number;
  devCode?: string;
}

/** Re-sends a code for the phone in the current challenge. The server decides whether the cooldown has passed. */
export async function resendOtp(): Promise<ResendState> {
  const challenge = await readOtpChallengeCookie();
  if (!challenge) return { error: "Start again by entering your number." };
  const meta = await requestMeta();
  const result = await requestOtp(getDb(), { phoneInput: `+960${challenge.phoneLocal.replace(/\s/g, "")}`, ip: meta.ip, sms: getSmsProvider() });
  if (!result.ok) {
    if (result.code === "COOLDOWN") return { error: "Wait a moment before requesting another code.", resendAvailableAt: result.retryAt?.getTime() };
    if (result.code === "RATE_LIMITED") return { error: "You've requested too many codes. Try again later.", resendAvailableAt: result.retryAt?.getTime() };
    return { error: "We couldn't send your code right now. Try again in a moment." };
  }
  await setOtpChallengeCookie({
    challengeId: result.challengeId,
    phoneLocal: challenge.phoneLocal,
    resendAvailableAt: result.resendAvailableAt.getTime(),
    expiresAt: result.expiresAt.getTime(),
    devCode: result.devCode,
  });
  return { resendAvailableAt: result.resendAvailableAt.getTime(), devCode: result.devCode };
}

export async function logout(): Promise<void> {
  const token = await readSessionToken();
  if (token) await revokeSession(getDb(), token);
  await clearSessionCookie();
  redirect(ROUTES.welcome);
}

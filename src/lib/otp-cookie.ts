/**
 * Short-lived HttpOnly cookie carrying the current OTP challenge between the phone and code screens.
 * Signed with SESSION_SECRET so it cannot be forged; contains no secret (the code hash stays in the database).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";

export const OTP_COOKIE = "thundi_otp";

export interface OtpChallengeCookie {
  challengeId: string;
  /** "7XX XXXX" for display only. */
  phoneLocal: string;
  resendAvailableAt: number;
  expiresAt: number;
  /** Development echo only; never present in production (env validation refuses the flag). */
  devCode?: string;
}

function sign(payload: string): string {
  return createHmac("sha256", getEnv().SESSION_SECRET).update(payload).digest("base64url");
}

export async function setOtpChallengeCookie(value: OtpChallengeCookie): Promise<void> {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const store = await cookies();
  store.set(OTP_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth",
    // Outlives the 5-minute challenge so the verify screen can still explain that the code expired
    // (and offer a new one) instead of silently bouncing back to the phone screen.
    expires: new Date(value.expiresAt + 25 * 60_000),
  });
}

export async function readOtpChallengeCookie(): Promise<OtpChallengeCookie | null> {
  const store = await cookies();
  const raw = store.get(OTP_COOKIE)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as OtpChallengeCookie;
    if (typeof parsed.challengeId !== "string" || typeof parsed.phoneLocal !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Whether the challenge referenced by the cookie is already past its expiry (server time). */
export function isChallengeExpired(challenge: OtpChallengeCookie, now = Date.now()): boolean {
  return challenge.expiresAt <= now;
}

export async function clearOtpChallengeCookie(): Promise<void> {
  const store = await cookies();
  store.set(OTP_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/auth", maxAge: 0, secure: process.env.NODE_ENV === "production" });
}

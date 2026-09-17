/**
 * Phone OTP challenges (docs/ARCHITECTURE.md §4.1).
 *
 * Guarantees: cryptographically random codes; only HMAC(pepper, challengeId:code) is stored; 5-minute expiry;
 * 5 verification attempts; 45-second resend cooldown; per-phone and per-IP request limits; one-time use;
 * new requests supersede open ones; identical responses whether or not an account exists.
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/db";
import { getEnv, isDevOtpEchoEnabled } from "@/lib/env";
import { hashPhone } from "@/lib/hashing";
import { normalizeMaldivianPhone } from "./phone";
import { consumeRateLimit } from "./rate-limit";
import { createSession, type CreatedSession } from "./session";
import type { SmsProvider } from "./sms";
import { createAccountForPhone } from "@/server/users/account";

export const OTP_RULES = {
  length: 6,
  ttlMs: 5 * 60_000,
  maxAttempts: 5,
  resendCooldownMs: 45_000,
  perPhonePerHour: 5,
  perIpPerHour: 20,
} as const;

export type RequestOtpResult =
  | { ok: true; challengeId: string; expiresAt: Date; resendAvailableAt: Date; phoneE164: string; devCode?: string }
  | { ok: false; code: "INVALID_PHONE" | "RATE_LIMITED" | "COOLDOWN" | "SMS_FAILED"; retryAt?: Date };

export type VerifyOtpResult =
  | { ok: true; userId: string; session: CreatedSession; destination: "onboarding" | "app"; isNewAccount: boolean }
  | { ok: false; code: "INVALID_CODE" | "CODE_EXPIRED" | "CODE_USED" | "TOO_MANY_ATTEMPTS" | "ACCOUNT_UNAVAILABLE"; attemptsRemaining?: number };

function codeHash(challengeId: string, code: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHmac("sha256", getEnv().OTP_PEPPER).update(`${challengeId}:${code}`).digest());
}

function ipHash(ip: string | null | undefined): Uint8Array<ArrayBuffer> | null {
  if (!ip) return null;
  return Uint8Array.from(createHmac("sha256", getEnv().OTP_PEPPER).update(`ip:${ip}`).digest());
}

function generateCode(): string {
  return String(randomInt(0, 10 ** OTP_RULES.length)).padStart(OTP_RULES.length, "0");
}

export interface RequestOtpInput {
  phoneInput: string;
  ip?: string | null;
  now?: Date;
  sms: SmsProvider;
}

export async function requestOtp(db: Db, input: RequestOtpInput): Promise<RequestOtpResult> {
  const now = input.now ?? new Date();
  const phone = normalizeMaldivianPhone(input.phoneInput);
  if (!phone.ok) return { ok: false, code: "INVALID_PHONE" };
  const phoneHash = hashPhone(phone.e164);

  // Abuse limits first, before any per-account work, so the cost of probing is bounded.
  const hour = 3_600_000;
  const byPhone = await consumeRateLimit(db, `otp:phone:${Buffer.from(phoneHash).toString("hex")}`, OTP_RULES.perPhonePerHour, hour, now);
  if (!byPhone.allowed) return { ok: false, code: "RATE_LIMITED", retryAt: byPhone.retryAt };
  if (input.ip) {
    const byIp = await consumeRateLimit(db, `otp:ip:${Buffer.from(ipHash(input.ip)!).toString("hex")}`, OTP_RULES.perIpPerHour, hour, now);
    if (!byIp.allowed) return { ok: false, code: "RATE_LIMITED", retryAt: byIp.retryAt };
  }

  const latest = await db.otpRequest.findFirst({ where: { phoneHash }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (latest && now.getTime() - latest.createdAt.getTime() < OTP_RULES.resendCooldownMs) {
    return { ok: false, code: "COOLDOWN", retryAt: new Date(latest.createdAt.getTime() + OTP_RULES.resendCooldownMs) };
  }

  // Supersede any open challenge for this phone: only the newest code can ever verify.
  await db.otpRequest.updateMany({ where: { phoneHash, consumedAt: null, supersededAt: null }, data: { supersededAt: now } });

  const challengeId = randomUUID();
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + OTP_RULES.ttlMs);
  await db.otpRequest.create({
    data: { id: challengeId, phoneHash, phoneE164: phone.e164, codeHash: codeHash(challengeId, code), expiresAt, ipHash: ipHash(input.ip), createdAt: now },
  });

  try {
    await input.sms.sendOtp({ to: phone.e164, code, expiresInMinutes: OTP_RULES.ttlMs / 60_000 });
  } catch {
    await db.otpRequest.update({ where: { id: challengeId }, data: { supersededAt: now } });
    return { ok: false, code: "SMS_FAILED" };
  }

  return {
    ok: true,
    challengeId,
    expiresAt,
    resendAvailableAt: new Date(now.getTime() + OTP_RULES.resendCooldownMs),
    phoneE164: phone.e164,
    ...(isDevOtpEchoEnabled() ? { devCode: code } : {}),
  };
}

export interface VerifyOtpInput {
  challengeId: string;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}

export type VerifyOtpCodeResult =
  | { ok: true; phoneE164: string }
  | { ok: false; code: "INVALID_CODE" | "CODE_EXPIRED" | "CODE_USED" | "TOO_MANY_ATTEMPTS"; attemptsRemaining?: number };

/**
 * Checks and consumes a challenge without signing anyone in. Shared by sign-in and by re-authentication before
 * destructive account actions (docs/ARCHITECTURE.md §4.4). Same attempt limits and one-time use as sign-in.
 */
export async function verifyOtpCode(db: Db, input: { challengeId: string; code: string; now?: Date }): Promise<VerifyOtpCodeResult> {
  const now = input.now ?? new Date();
  const code = (input.code ?? "").replace(/\D/g, "");
  if (!/^[0-9a-f-]{36}$/i.test(input.challengeId ?? "")) return { ok: false, code: "INVALID_CODE" };

  const challenge = await db.otpRequest.findUnique({ where: { id: input.challengeId } });
  if (!challenge) return { ok: false, code: "INVALID_CODE" };
  if (challenge.consumedAt || challenge.supersededAt) return { ok: false, code: "CODE_USED" };
  if (challenge.expiresAt.getTime() <= now.getTime()) return { ok: false, code: "CODE_EXPIRED" };
  if (challenge.attempts >= OTP_RULES.maxAttempts) return { ok: false, code: "TOO_MANY_ATTEMPTS" };

  const expected = challenge.codeHash;
  const provided = code.length === OTP_RULES.length ? codeHash(challenge.id, code) : new Uint8Array(expected.length);
  const matches = code.length === OTP_RULES.length && timingSafeEqual(provided, expected);

  if (!matches) {
    // Atomic increment; the check above plus this write bound total attempts even under concurrency.
    const updated = await db.otpRequest.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } }, select: { attempts: true } });
    const remaining = Math.max(0, OTP_RULES.maxAttempts - updated.attempts);
    return remaining === 0 ? { ok: false, code: "TOO_MANY_ATTEMPTS", attemptsRemaining: 0 } : { ok: false, code: "INVALID_CODE", attemptsRemaining: remaining };
  }

  // One-time use: the conditional update is the race guard. Two concurrent correct submissions yield one success.
  const consumed = await db.otpRequest.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: now } });
  if (consumed.count === 0) return { ok: false, code: "CODE_USED" };
  return { ok: true, phoneE164: challenge.phoneE164 };
}

export async function verifyOtp(db: Db, input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const now = input.now ?? new Date();
  const checked = await verifyOtpCode(db, { challengeId: input.challengeId, code: input.code, now });
  if (!checked.ok) return checked;
  const account = await createAccountForPhone(db, checked.phoneE164, now);
  if (account.status === "SUSPENDED" || account.status === "BANNED" || account.status === "DELETED") {
    return { ok: false, code: "ACCOUNT_UNAVAILABLE" };
  }
  const session = await createSession(db, account.id, { ip: input.ip, userAgent: input.userAgent }, now);
  return {
    ok: true,
    userId: account.id,
    session,
    destination: account.onboardingCompletedAt ? "app" : "onboarding",
    isNewAccount: account.isNew,
  };
}

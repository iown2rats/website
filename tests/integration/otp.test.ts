import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { hashPhone } from "@/lib/hashing";
import { OTP_RULES, requestOtp, verifyOtp } from "@/server/auth/otp";
import { MemorySmsProvider } from "@/server/auth/sms";
import { resolveSession } from "@/server/auth/session";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, minutes } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");
const PHONE = "777 1234";

function sms() {
  return new MemorySmsProvider();
}

async function request(phone = PHONE, now = T0, provider = sms(), ip: string | null = "10.0.0.1") {
  const r = await requestOtp(db, { phoneInput: phone, ip, now, sms: provider });
  return { r, provider };
}

beforeEach(async () => {
  await resetDb(db);
  delete process.env.THUNDI_DEV_OTP_ECHO;
  resetEnvCache();
});
afterEach(() => {
  delete process.env.THUNDI_DEV_OTP_ECHO;
  resetEnvCache();
});
afterAll(() => disconnectDb());

describe("OTP request", () => {
  it("stores only a hash of the code, never the code itself", async () => {
    const { r, provider } = await request();
    expect(r.ok).toBe(true);
    const sent = provider.sent[0]!;
    expect(sent.to).toBe("+9607771234");
    expect(sent.code).toMatch(/^\d{6}$/);
    const row = await db.otpRequest.findUniqueOrThrow({ where: { id: r.ok ? r.challengeId : "" } });
    expect(Buffer.from(row.codeHash).toString("hex")).not.toContain(Buffer.from(sent.code).toString("hex"));
    expect(row.codeHash.byteLength).toBe(32);
    expect(JSON.stringify(row)).not.toContain(sent.code);
    expect(r.ok && r.devCode).toBeUndefined();
  });

  it("normalises the phone so formatting differences never create separate challenges or accounts", async () => {
    const a = await request("+960 777-1234", T0);
    const b = await request("7771234", at(T0, OTP_RULES.resendCooldownMs));
    expect(a.r.ok && b.r.ok).toBe(true);
    const rows = await db.otpRequest.findMany();
    expect(new Set(rows.map((x) => Buffer.from(x.phoneHash).toString("hex"))).size).toBe(1);
  });

  it("rejects invalid numbers without touching the database", async () => {
    const { r } = await request("12345");
    expect(r).toEqual({ ok: false, code: "INVALID_PHONE" });
    expect(await db.otpRequest.count()).toBe(0);
  });

  it("enforces the resend cooldown using server time", async () => {
    await request(PHONE, T0);
    const tooSoon = await request(PHONE, at(T0, 10_000));
    expect(tooSoon.r).toMatchObject({ ok: false, code: "COOLDOWN", retryAt: at(T0, OTP_RULES.resendCooldownMs) });
    const ok = await request(PHONE, at(T0, OTP_RULES.resendCooldownMs));
    expect(ok.r.ok).toBe(true);
  });

  it("rate-limits requests per phone per hour", async () => {
    for (let i = 0; i < OTP_RULES.perPhonePerHour; i++) {
      const { r } = await request(PHONE, at(T0, i * minutes(1)), sms(), null);
      expect(r.ok, `request ${i + 1}`).toBe(true);
    }
    const blocked = await request(PHONE, at(T0, minutes(6)), sms(), null);
    expect(blocked.r).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("rate-limits requests per IP across different phones", async () => {
    for (let i = 0; i < OTP_RULES.perIpPerHour; i++) {
      const { r } = await request(`77${String(10000 + i).padStart(5, "0")}`, at(T0, i * 1000), sms(), "203.0.113.9");
      expect(r.ok, `request ${i + 1}`).toBe(true);
    }
    const blocked = await request("7999999", at(T0, minutes(1)), sms(), "203.0.113.9");
    expect(blocked.r).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("returns the same shape for a brand-new number and an existing account (no enumeration)", async () => {
    const existing = await createUser(db, { now: T0 });
    const a = await request(existing.phoneE164, T0, sms(), "10.0.0.2");
    const b = await request("7770001", T0, sms(), "10.0.0.3");
    expect(a.r.ok && b.r.ok).toBe(true);
    if (a.r.ok && b.r.ok) {
      expect(Object.keys(a.r).sort()).toEqual(Object.keys(b.r).sort());
      expect(a.r.expiresAt.getTime() - T0.getTime()).toBe(b.r.expiresAt.getTime() - T0.getTime());
    }
  });

  it("supersedes the previous open challenge so only the newest code can verify", async () => {
    const first = await request(PHONE, T0);
    const second = await request(PHONE, at(T0, OTP_RULES.resendCooldownMs));
    if (!first.r.ok || !second.r.ok) throw new Error("setup");
    const old = await verifyOtp(db, { challengeId: first.r.challengeId, code: first.provider.sent[0]!.code, now: at(T0, minutes(1)) });
    expect(old).toMatchObject({ ok: false, code: "CODE_USED" });
    const fresh = await verifyOtp(db, { challengeId: second.r.challengeId, code: second.provider.sent[0]!.code, now: at(T0, minutes(1)) });
    expect(fresh.ok).toBe(true);
  });

  it("echoes the code only when the development switch is on outside production", async () => {
    process.env.THUNDI_DEV_OTP_ECHO = "true";
    resetEnvCache();
    const { r, provider } = await request(PHONE, T0);
    expect(r.ok && r.devCode).toBe(provider.sent[0]!.code);

    // In production the switch is refused at boot.
    const original = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: "production", SMS_PROVIDER: "none", STORAGE_PROVIDER: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" });
    resetEnvCache();
    await expect(request(PHONE, at(T0, OTP_RULES.resendCooldownMs))).rejects.toThrow(/THUNDI_DEV_OTP_ECHO/);
    Object.assign(process.env, { NODE_ENV: original, SMS_PROVIDER: "console", STORAGE_PROVIDER: "local" });
    resetEnvCache();
  });
});

describe("OTP verification", () => {
  it("accepts the correct code, creates the account once and returns a working session", async () => {
    const { r, provider } = await request();
    if (!r.ok) throw new Error("setup");
    const v = await verifyOtp(db, { challengeId: r.challengeId, code: provider.sent[0]!.code, now: at(T0, 30_000) });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.destination).toBe("onboarding");
    expect(v.isNewAccount).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { id: v.userId }, include: { privacy: true, discoveryPreferences: true, notificationSettings: true, verification: true } });
    expect(user.phoneE164).toBe("+9607771234");
    expect(Buffer.from(user.phoneHash)).toEqual(Buffer.from(hashPhone("+9607771234")));
    expect(user.status).toBe("ONBOARDING");
    expect(user.onboardingStage).toBe("NAME");
    expect(user.privacy && user.discoveryPreferences && user.notificationSettings).toBeTruthy();
    expect(user.verification?.status).toBe("PHONE_VERIFIED");
    const session = await resolveSession(db, v.session.token, at(T0, 60_000));
    expect(session?.user.id).toBe(v.userId);
  });

  it("logs a returning completed user straight to the app without creating a second account", async () => {
    const existing = await createUser(db, { now: T0 });
    const { r, provider } = await request(existing.phoneE164);
    if (!r.ok) throw new Error("setup");
    const v = await verifyOtp(db, { challengeId: r.challengeId, code: provider.sent[0]!.code, now: T0 });
    expect(v).toMatchObject({ ok: true, userId: existing.userId, destination: "app", isNewAccount: false });
    expect(await db.user.count({ where: { phoneE164: existing.phoneE164 } })).toBe(1);
  });

  it("rejects a wrong code and counts attempts", async () => {
    const { r, provider } = await request();
    if (!r.ok) throw new Error("setup");
    const wrong = provider.sent[0]!.code === "000000" ? "111111" : "000000";
    const v = await verifyOtp(db, { challengeId: r.challengeId, code: wrong, now: T0 });
    expect(v).toMatchObject({ ok: false, code: "INVALID_CODE", attemptsRemaining: OTP_RULES.maxAttempts - 1 });
    expect(await db.session.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
  });

  it("rejects an expired code", async () => {
    const { r, provider } = await request();
    if (!r.ok) throw new Error("setup");
    const v = await verifyOtp(db, { challengeId: r.challengeId, code: provider.sent[0]!.code, now: at(T0, OTP_RULES.ttlMs) });
    expect(v).toMatchObject({ ok: false, code: "CODE_EXPIRED" });
  });

  it("a code can only be used once, even under concurrent submission", async () => {
    const { r, provider } = await request();
    if (!r.ok) throw new Error("setup");
    const code = provider.sent[0]!.code;
    const results = await Promise.all(Array.from({ length: 4 }, () => verifyOtp(db, { challengeId: r.challengeId, code, now: T0 })));
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.filter((x) => !x.ok && x.code === "CODE_USED")).toHaveLength(3);
    expect(await db.user.count()).toBe(1);
    expect(await db.session.count()).toBe(1);
    const again = await verifyOtp(db, { challengeId: r.challengeId, code, now: at(T0, 1000) });
    expect(again).toMatchObject({ ok: false, code: "CODE_USED" });
  });

  it("locks the challenge after the maximum number of wrong attempts, even if the right code follows", async () => {
    const { r, provider } = await request();
    if (!r.ok) throw new Error("setup");
    const code = provider.sent[0]!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_RULES.maxAttempts - 1; i++) {
      expect(await verifyOtp(db, { challengeId: r.challengeId, code: wrong, now: T0 })).toMatchObject({ ok: false, code: "INVALID_CODE" });
    }
    expect(await verifyOtp(db, { challengeId: r.challengeId, code: wrong, now: T0 })).toMatchObject({ ok: false, code: "TOO_MANY_ATTEMPTS" });
    expect(await verifyOtp(db, { challengeId: r.challengeId, code, now: T0 })).toMatchObject({ ok: false, code: "TOO_MANY_ATTEMPTS" });
    expect(await db.session.count()).toBe(0);
  });

  it("responds identically to unknown challenges and malformed input", async () => {
    expect(await verifyOtp(db, { challengeId: "00000000-0000-4000-8000-000000000000", code: "123456", now: T0 })).toEqual({ ok: false, code: "INVALID_CODE" });
    expect(await verifyOtp(db, { challengeId: "not-a-uuid", code: "123456", now: T0 })).toEqual({ ok: false, code: "INVALID_CODE" });
  });

  it("refuses to sign in a suspended account", async () => {
    const user = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: user.userId }, data: { status: "SUSPENDED" } });
    const { r, provider } = await request(user.phoneE164);
    if (!r.ok) throw new Error("setup");
    const v = await verifyOtp(db, { challengeId: r.challengeId, code: provider.sent[0]!.code, now: T0 });
    expect(v).toMatchObject({ ok: false, code: "ACCOUNT_UNAVAILABLE" });
    expect(await db.session.count()).toBe(0);
  });
});

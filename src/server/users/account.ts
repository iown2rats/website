/**
 * Account creation and lookup by verified phone. Called only after a successful OTP verification.
 */
import { randomBytes } from "node:crypto";
import type { Db } from "@/lib/db";
import { hashPhone } from "@/lib/hashing";

export interface AccountRecord {
  id: string;
  status: "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";
  onboardingCompletedAt: Date | null;
  isNew: boolean;
}

/** Opaque public handle used in URLs instead of the database id. */
export function generateHandle(): string {
  return randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().padEnd(8, "x").slice(0, 10);
}

/**
 * Finds the account for a normalised E.164 number or creates it with every settings row present.
 * The unique constraint on phoneE164 makes concurrent first verifications converge on one account.
 */
export async function createAccountForPhone(db: Db, phoneE164: string, now: Date = new Date()): Promise<AccountRecord> {
  const existing = await db.user.findUnique({ where: { phoneE164 }, select: { id: true, status: true, onboardingCompletedAt: true } });
  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: { lastActiveAt: now } });
    return { ...existing, isNew: false };
  }
  try {
    const created = await db.user.create({
      data: {
        phoneE164,
        phoneHash: hashPhone(phoneE164),
        status: "ONBOARDING",
        onboardingStage: "NAME",
        lastActiveAt: now,
        createdAt: now,
        privacy: { create: {} },
        discoveryPreferences: { create: {} },
        notificationSettings: { create: {} },
        verification: { create: { status: "PHONE_VERIFIED" } },
      },
      select: { id: true, status: true, onboardingCompletedAt: true },
    });
    return { ...created, isNew: true };
  } catch (e) {
    // Lost a race with a concurrent verification for the same number: use the winner's account.
    const winner = await db.user.findUnique({ where: { phoneE164 }, select: { id: true, status: true, onboardingCompletedAt: true } });
    if (winner) return { ...winner, isNew: false };
    throw e;
  }
}

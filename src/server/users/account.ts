/**
 * Account creation for a verified sign-in identity (docs/ARCHITECTURE.md §4.1). Google authenticates the person;
 * User.id stays our canonical identity for every relation. New accounts start ONBOARDING with every settings row
 * present and verification NONE: signing in with Google does not verify a phone and never grants the dating seal.
 */
import { randomBytes } from "node:crypto";
import type { DbLike } from "@/lib/db";

export interface AccountRecord {
  id: string;
  status: "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";
  onboardingCompletedAt: Date | null;
}

/** Opaque public handle used in URLs instead of the database id. */
export function generateHandle(): string {
  return randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().padEnd(8, "x").slice(0, 10);
}

export async function createAccount(db: DbLike, now: Date = new Date()): Promise<AccountRecord> {
  return db.user.create({
    data: {
      status: "ONBOARDING",
      onboardingStage: "NAME",
      lastActiveAt: now,
      createdAt: now,
      privacy: { create: {} },
      discoveryPreferences: { create: {} },
      notificationSettings: { create: {} },
      verification: { create: { status: "NONE" } },
    },
    select: { id: true, status: true, onboardingCompletedAt: true },
  });
}

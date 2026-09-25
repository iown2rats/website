/**
 * Whether to show the Discover "Get verified" reminder (docs/ARCHITECTURE.md §11.1), decided from the member's own
 * Verification row — never from anything the browser holds.
 *
 * Shown only while the member could actually start verifying right now, which is exactly what `submitBlocker` already
 * answers for the verification flow itself:
 *
 *   NONE / PHONE_VERIFIED (legacy, = NONE)   shown
 *   SELFIE_SUBMITTED / UNDER_REVIEW          hidden — already pending; telling them to verify again would mislead,
 *                                             and the verification page shows the pending state
 *   VERIFIED                                  hidden, for as long as they stay verified
 *   REJECTED, inside the 24 h retry window    hidden — there is nothing they can do yet
 *   REJECTED, retry allowed                   shown — the flow explains the earlier decision and lets them retry
 *
 * Also hidden for anyone who is not an ordinary, active, onboarded member: staff accounts, members holding a staff
 * role, and accounts that are onboarding, suspended or deleted.
 *
 * Read-only on purpose: `getVerificationState` creates a missing row, and a Discover page view must not write.
 */
import { createHash } from "node:crypto";
import type { DbLike } from "@/lib/db";
import { submitBlocker } from "./verification";
import type { VerificationStatus } from "./state";

export interface VerificationReminderDto {
  /** Browser-storage key for this member's snooze. Derived from the member id, so it never exposes it. */
  dismissKey: string;
}

export function reminderDismissKey(userId: string): string {
  return `mc:verify-reminder:${createHash("sha256").update(`verify-reminder:${userId}`).digest("hex").slice(0, 20)}`;
}

export async function getVerificationReminder(db: DbLike, userId: string, now: Date = new Date()): Promise<VerificationReminderDto | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { accountType: true, role: true, status: true, deletedAt: true, onboardingCompletedAt: true, verification: { select: { status: true, decidedAt: true } } },
  });
  if (!user || user.accountType !== "MEMBER" || user.role !== "USER" || user.deletedAt) return null;
  const status = (user.verification?.status ?? "NONE") as VerificationStatus;
  const blocker = submitBlocker({ status, decidedAt: user.verification?.decidedAt ?? null, accountStatus: user.status, onboardingCompletedAt: user.onboardingCompletedAt }, now);
  return blocker === null ? { dismissKey: reminderDismissKey(userId) } : null;
}

/**
 * Verification state machine (docs/ARCHITECTURE.md §11). One table of allowed edges, enforced inside every
 * transaction that changes the status. PHONE_VERIFIED is a legacy value that behaves like NONE.
 *
 *   NONE | PHONE_VERIFIED | REJECTED  → SELFIE_SUBMITTED   (the member submits a selfie)
 *   SELFIE_SUBMITTED                  → UNDER_REVIEW        (the review provider accepts it; manual review does so at once)
 *   SELFIE_SUBMITTED | UNDER_REVIEW   → VERIFIED | REJECTED (an admin or moderator decides)
 */
import { InvalidStateError } from "@/lib/errors";

export type VerificationStatus = "NONE" | "PHONE_VERIFIED" | "SELFIE_SUBMITTED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED";

export const VERIFICATION_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  NONE: ["SELFIE_SUBMITTED"],
  PHONE_VERIFIED: ["SELFIE_SUBMITTED"],
  REJECTED: ["SELFIE_SUBMITTED"],
  SELFIE_SUBMITTED: ["UNDER_REVIEW", "VERIFIED", "REJECTED"],
  UNDER_REVIEW: ["VERIFIED", "REJECTED"],
  VERIFIED: [],
};

export const PENDING_VERIFICATION_STATUSES: readonly VerificationStatus[] = ["SELFIE_SUBMITTED", "UNDER_REVIEW"];

export function canTransitionVerification(from: VerificationStatus, to: VerificationStatus): boolean {
  return VERIFICATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertVerificationTransition(from: VerificationStatus, to: VerificationStatus): void {
  if (!canTransitionVerification(from, to)) throw new InvalidStateError(`Verification cannot move from ${from} to ${to}`);
}

/** The four states a member sees. Pending covers both server-side pending statuses. */
export type VerificationPhase = "NONE" | "PENDING" | "VERIFIED" | "REJECTED";

export function phaseOf(status: VerificationStatus): VerificationPhase {
  if (status === "VERIFIED") return "VERIFIED";
  if (status === "REJECTED") return "REJECTED";
  if (status === "SELFIE_SUBMITTED" || status === "UNDER_REVIEW") return "PENDING";
  return "NONE";
}

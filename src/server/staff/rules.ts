/**
 * Pure rules for the staff domain (docs/ARCHITECTURE.md §22.1). No database and no server imports, so the admin
 * UI and the unit tests can use exactly the rules the server enforces.
 */

export type StaffRole = "ADMIN" | "MODERATOR";
export const STAFF_ROLES: readonly StaffRole[] = ["ADMIN", "MODERATOR"];

export function isStaffRole(role: string): role is StaffRole {
  return role === "ADMIN" || role === "MODERATOR";
}

export const STAFF_RULES = {
  /** An invitation link is good for three days; long enough for a colleague to get to it, short enough to expire. */
  inviteTtlMs: 3 * 24 * 3_600_000,
  /** Staff created per admin, per hour. */
  grantsPerAdminHour: 20,
  /** Invitation emails per grant, per hour, plus a cooldown so a double tap does not burn one. */
  resendsPerHour: 5,
  resendCooldownMs: 60_000,
  /** Attempts to claim an invitation, per client, per hour. */
  claimAttemptsPerClientHour: 20,
  /** Admin portal sign-in attempts, per address and per client, per 15 minutes. Tighter than the member limits. */
  loginAttemptsPerEmail: 5,
  loginAttemptsPerClient: 20,
  loginWindowMs: 15 * 60_000,
  /** Staff "forgot password" requests, per address and per client, per hour. */
  resetRequestsPerEmailHour: 3,
  resetRequestsPerClientHour: 10,
  reasonMin: 3,
  reasonMax: 300,
} as const;

/**
 * The single normalisation used everywhere an address is compared, stored or looked up: trim, lowercase, and
 * nothing else. No dot-stripping and no plus-address folding — those differ per provider, and guessing wrong would
 * either merge two real people or let one address slip past the "one open grant per address" index.
 */
export function normalizeStaffEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Deliberately conservative: one @, no whitespace, a dot in the domain, and a sane length. */
export function isPlausibleEmail(email: string): boolean {
  if (email.length < 6 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length === 0 || domain.length < 3) return false;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  return true;
}

export interface ReasonProblem {
  message: string;
}

export function validateReason(raw: unknown): { ok: true; reason: string } | { ok: false; message: string } {
  const reason = String(raw ?? "").trim();
  if (reason.length < STAFF_RULES.reasonMin || reason.length > STAFF_RULES.reasonMax) {
    return { ok: false, message: `Give a short reason (${STAFF_RULES.reasonMin}–${STAFF_RULES.reasonMax} characters).` };
  }
  if (/[<>]/.test(reason)) return { ok: false, message: "Leave out angle brackets." };
  return { ok: true, reason };
}

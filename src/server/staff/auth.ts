/**
 * Admin portal authentication (docs/ARCHITECTURE.md §22.2).
 *
 * Staff sign in with an email address and a password, and this module reuses the member system's cryptographic
 * primitives rather than inventing a second one: the same scrypt verifier from src/server/auth/password.ts, the
 * same hashed single-use AuthToken rows from src/server/auth/auth-tokens.ts, the same Postgres rate limiter, the
 * same opaque database-backed session. What is *not* shared is the lifecycle: a staff sign-in additionally
 * requires an ACTIVE StaffGrant and a STAFF account, and a member sign-in additionally refuses one. The two
 * domains use the same locks and keys; they do not open the same doors.
 *
 * Nothing here distinguishes "no such address", "wrong password", "member account", "pending invitation" or
 * "revoked" to the visitor: every failure is one sentence, so the portal cannot be used to discover who is staff.
 */
import type { Db, DbLike } from "@/lib/db";
import { getEmailProvider, type EmailProvider } from "@/lib/email";
import { staffInviteEmail, staffPasswordResetEmail } from "@/lib/email/templates";
import { getEnv } from "@/lib/env";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { consumeAuthToken, issueAuthToken, TOKEN_TTL_MS } from "@/server/auth/auth-tokens";
import { hashPassword, validatePassword, verifyPassword } from "@/server/auth/password";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { isPlausibleEmail, isStaffRole, normalizeStaffEmail, STAFF_RULES, type StaffRole } from "./rules";

const EMAIL_PROVIDER = "EMAIL" as const;
const GENERIC_SIGN_IN_FAILURE = "That email and password don't match a staff account.";
const GENERIC_RATE_LIMIT = "Too many attempts. Try again in a little while.";

export type StaffAuthResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: undefined } : { value: T }))
  | { ok: false; code: "INVALID_CREDENTIALS" | "RATE_LIMITED" | "WEAK_PASSWORD" | "INVALID_TOKEN"; message: string; field?: "email" | "password" };

export interface StaffAuthDeps {
  db: Db;
  email?: EmailProvider;
  now?: Date;
  clientKey?: string | null;
}

export function staffSetupUrl(token: string): string {
  return new URL(`/admin/set-password?token=${encodeURIComponent(token)}`, getEnv().APP_URL).toString();
}
export function staffResetUrl(token: string): string {
  return new URL(`/admin/reset-password?token=${encodeURIComponent(token)}`, getEnv().APP_URL).toString();
}

/** Delivery failures are logged without the address and never change what the visitor is told. */
async function deliver(provider: EmailProvider, to: string, message: { subject: string; text: string; html: string }): Promise<void> {
  try {
    await provider.send({ to, ...message });
  } catch (e) {
    console.warn("[staff] invitation/reset email not delivered:", e instanceof Error ? e.message : e);
  }
}

/** Sends an invitation or set-password link. The raw token exists only in this call and the email. */
export async function sendStaffInviteEmail(to: string, token: string, expiresAt: Date, opts: { setup: boolean; provider?: EmailProvider; now?: Date }): Promise<void> {
  const provider = opts.provider ?? getEmailProvider();
  const hours = Math.max(1, Math.round((expiresAt.getTime() - (opts.now ?? new Date()).getTime()) / 3_600_000));
  await deliver(provider, to, staffInviteEmail(staffSetupUrl(token), hours, opts.setup));
}

// ───────────────────────────── Sign-in ─────────────────────────────

export interface StaffSignInOutcome {
  userId: string;
  role: StaffRole;
}

/**
 * Verifies a staff password. The account must be STAFF, active, and hold an ACTIVE grant; a member account with a
 * perfectly good password gets the same single failure sentence as an unknown address.
 */
export async function signInStaff(input: { email: string; password: string }, deps: StaffAuthDeps): Promise<StaffAuthResult<StaffSignInOutcome>> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const email = normalizeStaffEmail(input?.email);

  const perEmail = await consumeRateLimit(db, `staff:login:email:${email}`, STAFF_RULES.loginAttemptsPerEmail, STAFF_RULES.loginWindowMs, now);
  const perClient = deps.clientKey
    ? await consumeRateLimit(db, `staff:login:client:${deps.clientKey}`, STAFF_RULES.loginAttemptsPerClient, STAFF_RULES.loginWindowMs, now)
    : { allowed: true };
  if (!perEmail.allowed || !perClient.allowed) return { ok: false, code: "RATE_LIMITED", message: GENERIC_RATE_LIMIT };

  const identity = email
    ? await db.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: EMAIL_PROVIDER, providerSubject: email } },
        select: {
          id: true, userId: true, passwordHash: true, emailVerified: true, releasedAt: true,
          user: { select: { accountType: true, status: true, role: true } },
        },
      })
    : null;

  // Always run the verifier, even with no identity, so a missing address costs the same time as a wrong password.
  const check = await verifyPassword(input?.password ?? "", identity?.passwordHash ?? null);
  const fail = { ok: false as const, code: "INVALID_CREDENTIALS" as const, message: GENERIC_SIGN_IN_FAILURE };
  if (!identity || !check.ok || identity.releasedAt !== null || !identity.emailVerified) return fail;

  const { user } = identity;
  if (user.accountType !== "STAFF" || user.status !== "ACTIVE" || !isStaffRole(user.role)) return fail;

  const grant = await db.staffGrant.findUnique({
    where: { claimedByUserId: identity.userId },
    select: { status: true, role: true },
  });
  if (!grant || grant.status !== "ACTIVE" || !isStaffRole(grant.role)) return fail;

  if (check.needsRehash) {
    const passwordHash = await hashPassword(input.password);
    await db.authIdentity.update({ where: { id: identity.id }, data: { passwordHash } });
  }
  await Promise.all([
    db.authIdentity.update({ where: { id: identity.id }, data: { lastLoginAt: now } }),
    db.user.update({ where: { id: identity.userId }, data: { lastActiveAt: now } }),
  ]);
  return { ok: true, value: { userId: identity.userId, role: grant.role } };
}

// ───────────────────────────── Forgot / reset ─────────────────────────────

/**
 * Starts "forgot password" for the portal. Always reports success, whatever the address is, so the response can
 * never be used to discover who is staff. A link is sent only to a live staff account that already has a password.
 */
export async function requestStaffPasswordReset(rawEmail: string, deps: StaffAuthDeps): Promise<StaffAuthResult> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const provider = deps.email ?? getEmailProvider();
  const email = normalizeStaffEmail(rawEmail);

  const perEmail = await consumeRateLimit(db, `staff:reset:email:${email}`, STAFF_RULES.resetRequestsPerEmailHour, 3_600_000, now);
  const perClient = deps.clientKey
    ? await consumeRateLimit(db, `staff:reset:client:${deps.clientKey}`, STAFF_RULES.resetRequestsPerClientHour, 3_600_000, now)
    : { allowed: true };
  // Even a rate-limited request answers "ok": a different answer would itself distinguish addresses.
  if (!perEmail.allowed || !perClient.allowed) return { ok: true };
  if (!isPlausibleEmail(email)) return { ok: true };

  const identity = await db.authIdentity.findUnique({
    where: { provider_providerSubject: { provider: EMAIL_PROVIDER, providerSubject: email } },
    select: { id: true, userId: true, email: true, passwordHash: true, releasedAt: true, user: { select: { accountType: true, status: true } } },
  });
  if (!identity || !identity.passwordHash || identity.releasedAt !== null) return { ok: true };
  if (identity.user.accountType !== "STAFF" || identity.user.status !== "ACTIVE") return { ok: true };
  const grant = await db.staffGrant.findUnique({ where: { claimedByUserId: identity.userId }, select: { status: true } });
  if (grant?.status !== "ACTIVE") return { ok: true };

  const { token } = await issueAuthToken(db, { identityId: identity.id, purpose: "PASSWORD_RESET" }, now);
  await deliver(provider, identity.email ?? email, staffPasswordResetEmail(staffResetUrl(token), TOKEN_TTL_MS.PASSWORD_RESET / 60_000));
  return { ok: true };
}

/**
 * Completes a portal reset. Refuses any token whose identity is not a live staff account, which is what stops a
 * reset link from ever conferring staff access on a member: resetting a password changes a password and nothing
 * else — it never touches accountType, role or a grant.
 */
export async function resetStaffPassword(input: { token: string; password: string }, deps: StaffAuthDeps): Promise<StaffAuthResult<{ userId: string }>> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const invalid = { ok: false as const, code: "INVALID_TOKEN" as const, message: "That reset link has expired or has already been used. Ask for a new one." };

  const weak = validatePassword(input?.password ?? "");
  if (weak) return { ok: false, code: "WEAK_PASSWORD", message: weak.message, field: "password" };

  const consumed = await consumeAuthToken(db, input.token, "PASSWORD_RESET", now);
  if (!consumed) return invalid;
  const identity = await db.authIdentity.findUnique({
    where: { id: consumed.identityId },
    select: { id: true, userId: true, provider: true, user: { select: { accountType: true, status: true } } },
  });
  if (!identity || identity.provider !== EMAIL_PROVIDER || identity.user.status === "DELETED") return invalid;
  if (identity.user.accountType !== "STAFF") return invalid;
  const grant = await db.staffGrant.findUnique({ where: { claimedByUserId: identity.userId }, select: { status: true } });
  if (grant?.status !== "ACTIVE") return invalid;

  const passwordHash = await hashPassword(input.password);
  await db.authIdentity.update({ where: { id: identity.id }, data: { passwordHash, passwordUpdatedAt: now } });
  await db.authToken.updateMany({ where: { identityId: identity.id, purpose: "PASSWORD_RESET", consumedAt: null }, data: { consumedAt: now } });
  // If the password was reset because somebody else had it, their sessions must end too.
  await db.session.deleteMany({ where: { userId: identity.userId } });
  await writeAudit(db, {
    actorId: identity.userId,
    action: AUDIT_ACTIONS.staffPasswordReset,
    targetType: "User",
    targetId: identity.userId,
    data: { via: "portal-reset" },
    now,
  });
  return { ok: true, value: { userId: identity.userId } };
}

/** Whether an account is a live staff account. Used by the guards and by the tests. */
export async function isLiveStaff(db: DbLike, userId: string): Promise<boolean> {
  const grant = await db.staffGrant.findUnique({ where: { claimedByUserId: userId }, select: { status: true, role: true } });
  return grant?.status === "ACTIVE" && isStaffRole(grant.role);
}

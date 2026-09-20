/**
 * Email + password sign-in (docs/ARCHITECTURE.md §4.1b), the third identity provider beside Google and Telegram.
 * It reuses the existing identity architecture exactly: one `AuthIdentity` row keyed on (provider, subject), mapped
 * to our canonical `User.id`, with the same sessions, onboarding and deletion protections.
 *
 * Shape of an EMAIL identity: `providerSubject` is the normalised address (the natural stable key for this
 * provider), `email` is the same value, `emailVerified` starts false and `passwordHash` holds the scrypt verifier.
 *
 * Rules that hold throughout:
 *  - An EMAIL identity is NEVER linked to a Google or Telegram account because the addresses match. Providers are
 *    separate people to the system until an explicit, authenticated linking step exists (there is none yet).
 *  - Nothing here reveals whether an address has an account. Registration, sign-in and "forgot password" all answer
 *    the same way whatever exists, and the difference is carried by the email that is (or is not) sent.
 *  - An account whose address is unverified gets a session but no member functionality; `authKindForUser` reports
 *    "unverified" and every route and server action refuses it (§4.2).
 */
import type { Db, DbLike } from "@/lib/db";
import { getEmailProvider, type EmailProvider } from "@/lib/email";
import { passwordResetEmail, verificationEmail } from "@/lib/email/templates";
import { getEnv } from "@/lib/env";
import { createAccount } from "@/server/users/account";
import { consumeAuthToken, issueAuthToken, TOKEN_TTL_MS } from "./auth-tokens";
import { hashPassword, validatePassword, verifyPassword } from "./password";
import { consumeRateLimit } from "./rate-limit";
import { revokeAllSessions } from "./session";

const PROVIDER = "EMAIL" as const;

export const EMAIL_AUTH_RULES = {
  /** Per address, per hour: repeated attempts to register the same address. */
  registrationsPerEmailHour: 3,
  /** Per client, per hour: stops one visitor enumerating or creating accounts in bulk. */
  registrationsPerClientHour: 5,
  /** Verification emails per identity, per hour, plus a short cooldown so a double tap does not burn one. */
  resendsPerHour: 4,
  resendCooldownMs: 60_000,
  /** Sign-in attempts per address and per client, per 15 minutes. */
  loginAttemptsPerEmail: 10,
  loginAttemptsPerClient: 30,
  loginWindowMs: 15 * 60_000,
  /** "Forgot password" requests per address and per client, per hour. */
  resetRequestsPerEmailHour: 3,
  resetRequestsPerClientHour: 10,
  /** Password confirmations for a sensitive action, per session, per 15 minutes. */
  reauthAttempts: 5,
  reauthWindowMs: 15 * 60_000,
} as const;

export interface EmailAuthDeps {
  db: Db;
  email?: EmailProvider;
  now?: Date;
  /** An opaque per-client key (an IP prefix) for the client-scoped limits. */
  clientKey?: string | null;
}

/** Every outcome a caller may show. `ok` results never say whether an address exists. */
export type EmailAuthResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: undefined } : { value: T }))
  | { ok: false; code: "INVALID" | "WEAK_PASSWORD" | "RATE_LIMITED" | "UNAVAILABLE" | "INVALID_CREDENTIALS" | "INVALID_TOKEN" | "EMAIL_TAKEN"; message: string; field?: "email" | "password" | "confirmPassword" };

const fail = (code: Exclude<EmailAuthResult["ok"] extends false ? never : never, never> | NonNullable<Extract<EmailAuthResult, { ok: false }>["code"]>, message: string, field?: "email" | "password" | "confirmPassword"): Extract<EmailAuthResult, { ok: false }> => ({ ok: false, code, message, field });

const GENERIC_RATE_LIMIT = "Too many attempts. Try again in a little while.";

function verificationUrl(token: string): string {
  return new URL(`/auth/verify?token=${encodeURIComponent(token)}`, getEnv().APP_URL).toString();
}
function resetUrl(token: string): string {
  return new URL(`/auth/reset-password?token=${encodeURIComponent(token)}`, getEnv().APP_URL).toString();
}

/** Delivery failures are logged without the address and never change what the visitor is told. */
async function deliver(provider: EmailProvider, to: string, message: { subject: string; text: string; html: string }): Promise<void> {
  try {
    await provider.send({ to, ...message });
  } catch (e) {
    console.warn("[auth] verification/reset email not delivered:", e instanceof Error ? e.message : e);
  }
}

async function sendVerification(db: DbLike, provider: EmailProvider, identityId: string, email: string, now: Date): Promise<void> {
  const { token } = await issueAuthToken(db, { identityId, purpose: "EMAIL_VERIFICATION", email }, now);
  await deliver(provider, email, verificationEmail(verificationUrl(token), TOKEN_TTL_MS.EMAIL_VERIFICATION / 3_600_000));
}

// ───────────────────────────── Registration ─────────────────────────────

export interface RegistrationOutcome {
  /** Set only when a brand-new account was created; an existing address yields the same visible result with none. */
  userId?: string;
  email: string;
}

/**
 * Creates an UNVERIFIED account and sends the verification link. An address that already has an EMAIL account gets
 * the same answer, and an email telling its owner that someone tried to register — so the response cannot be used
 * to discover who has an account, while the real owner still learns about the attempt.
 */
export async function registerWithEmail(input: { email: string; password: string }, deps: EmailAuthDeps): Promise<EmailAuthResult<RegistrationOutcome>> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const provider = deps.email ?? getEmailProvider();
  const email = input.email;

  const weak = validatePassword(input.password);
  if (weak) return fail("WEAK_PASSWORD", weak.message, "password");

  const perEmail = await consumeRateLimit(db, `auth:register:email:${email}`, EMAIL_AUTH_RULES.registrationsPerEmailHour, 3_600_000, now);
  const perClient = deps.clientKey ? await consumeRateLimit(db, `auth:register:client:${deps.clientKey}`, EMAIL_AUTH_RULES.registrationsPerClientHour, 3_600_000, now) : { allowed: true };
  if (!perEmail.allowed || !perClient.allowed) return fail("RATE_LIMITED", GENERIC_RATE_LIMIT);

  const existing = await db.authIdentity.findUnique({
    where: { provider_providerSubject: { provider: PROVIDER, providerSubject: email } },
    select: { id: true, emailVerified: true, user: { select: { status: true } } },
  });
  if (existing) {
    // Same visible outcome as a new registration. An unverified account simply gets its link again; a verified one
    // is told that an account already exists, which only its own owner can read.
    if (!existing.emailVerified && existing.user.status !== "DELETED") {
      await sendVerification(db, provider, existing.id, email, now);
    } else {
      await deliver(provider, email, {
        subject: "You already have a Mellocrush account",
        text: `Someone tried to create a Mellocrush account with this address, but it already has one.\n\nIf that was you, sign in instead — and use "Forgot password?" if you don't remember your password.\n\nIf it wasn't you, ignore this email. Nothing changed and nobody was told whether this address has an account.`,
        html: `<p>Someone tried to create a Mellocrush account with this address, but it already has one.</p><p>If that was you, sign in instead — and use “Forgot password?” if you don't remember your password.</p><p>If it wasn't you, ignore this email. Nothing changed and nobody was told whether this address has an account.</p>`,
      });
    }
    return { ok: true, value: { email } };
  }

  const passwordHash = await hashPassword(input.password);
  let identityId: string;
  let userId: string;
  try {
    const created = await db.$transaction(async (tx) => {
      const account = await createAccount(tx, now);
      const identity = await tx.authIdentity.create({
        data: { userId: account.id, provider: PROVIDER, providerSubject: email, email, emailVerified: false, passwordHash, passwordUpdatedAt: now, createdAt: now },
        select: { id: true },
      });
      return { identityId: identity.id, userId: account.id };
    });
    identityId = created.identityId;
    userId = created.userId;
  } catch {
    // Lost a race with a concurrent registration for the same address: behave exactly like the existing-account path.
    const winner = await db.authIdentity.findUnique({ where: { provider_providerSubject: { provider: PROVIDER, providerSubject: email } }, select: { id: true } });
    if (winner) await sendVerification(db, provider, winner.id, email, now);
    return { ok: true, value: { email } };
  }
  await sendVerification(db, provider, identityId, email, now);
  return { ok: true, value: { userId, email } };
}

// ───────────────────────────── Verification ─────────────────────────────

export interface VerificationOutcome {
  userId: string;
  /** True when this click is what flipped the address to verified (a second click on a used link never gets here). */
  verified: true;
}

/**
 * Confirms an address from a link. Server-side only: the token is looked up by its hash, consumed once, and the
 * identity is marked verified. A token issued for a previous address never verifies a new one.
 */
export async function verifyEmailToken(token: string, deps: EmailAuthDeps): Promise<EmailAuthResult<VerificationOutcome>> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const consumed = await consumeAuthToken(db, token, "EMAIL_VERIFICATION", now);
  if (!consumed) return fail("INVALID_TOKEN", "That link has expired or has already been used. Send yourself a new one.");
  const identity = await db.authIdentity.findUnique({ where: { id: consumed.identityId }, select: { id: true, userId: true, email: true, emailVerified: true, provider: true, user: { select: { status: true } } } });
  if (!identity || identity.provider !== PROVIDER || identity.user.status === "DELETED") {
    return fail("INVALID_TOKEN", "That link has expired or has already been used. Send yourself a new one.");
  }
  // The token names the address it confirms; after a change of address an older link no longer matches.
  if (consumed.email && identity.email !== consumed.email) {
    return fail("INVALID_TOKEN", "That link was sent to a different address. Send yourself a new one.");
  }
  if (!identity.emailVerified) {
    await db.authIdentity.update({ where: { id: identity.id }, data: { emailVerified: true } });
  }
  return { ok: true, value: { userId: identity.userId, verified: true } };
}

/** Sends the verification link again for the signed-in identity. Cooldown plus an hourly ceiling. */
export async function resendVerification(userId: string, deps: EmailAuthDeps): Promise<EmailAuthResult<{ email: string }>> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const provider = deps.email ?? getEmailProvider();
  const identity = await db.authIdentity.findFirst({ where: { userId, provider: PROVIDER, releasedAt: null }, select: { id: true, email: true, emailVerified: true } });
  if (!identity?.email) return fail("UNAVAILABLE", "This account doesn't sign in with an email address.");
  if (identity.emailVerified) return { ok: true, value: { email: identity.email } };

  const last = await db.authToken.findFirst({ where: { identityId: identity.id, purpose: "EMAIL_VERIFICATION" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && now.getTime() - last.createdAt.getTime() < EMAIL_AUTH_RULES.resendCooldownMs) {
    const seconds = Math.ceil((EMAIL_AUTH_RULES.resendCooldownMs - (now.getTime() - last.createdAt.getTime())) / 1000);
    return fail("RATE_LIMITED", `Wait ${seconds} seconds before asking for another email.`);
  }
  const limit = await consumeRateLimit(db, `auth:verify:resend:${identity.id}`, EMAIL_AUTH_RULES.resendsPerHour, 3_600_000, now);
  if (!limit.allowed) return fail("RATE_LIMITED", "You've asked for several emails already. Try again in an hour.");

  await sendVerification(db, provider, identity.id, identity.email, now);
  return { ok: true, value: { email: identity.email } };
}

/**
 * Changes the address of a still-unverified account and sends the link to the new one. Refused once verified: that
 * would be an account-recovery path, which needs its own design (§20). The old address keeps no claim on the
 * account, and the previous verification token stops working because the new token names the new address.
 */
export async function changeUnverifiedEmail(userId: string, newEmail: string, deps: EmailAuthDeps): Promise<EmailAuthResult<{ email: string }>> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const provider = deps.email ?? getEmailProvider();
  const identity = await db.authIdentity.findFirst({ where: { userId, provider: PROVIDER, releasedAt: null }, select: { id: true, email: true, emailVerified: true } });
  if (!identity) return fail("UNAVAILABLE", "This account doesn't sign in with an email address.");
  if (identity.emailVerified) return fail("UNAVAILABLE", "This address is already confirmed.");
  if (identity.email === newEmail) {
    return resendVerification(userId, deps);
  }
  const limit = await consumeRateLimit(db, `auth:verify:change:${identity.id}`, EMAIL_AUTH_RULES.resendsPerHour, 3_600_000, now);
  if (!limit.allowed) return fail("RATE_LIMITED", "You've changed this a few times already. Try again in an hour.");

  const taken = await db.authIdentity.findUnique({ where: { provider_providerSubject: { provider: PROVIDER, providerSubject: newEmail } }, select: { id: true } });
  if (taken) return fail("EMAIL_TAKEN", "That address can't be used. Try another one.", "email");
  try {
    await db.authIdentity.update({ where: { id: identity.id }, data: { providerSubject: newEmail, email: newEmail } });
  } catch {
    return fail("EMAIL_TAKEN", "That address can't be used. Try another one.", "email");
  }
  await sendVerification(db, provider, identity.id, newEmail, now);
  return { ok: true, value: { email: newEmail } };
}

// ───────────────────────────── Sign-in ─────────────────────────────

export interface EmailSignInOutcome {
  userId: string;
  emailVerified: boolean;
  /**
   * "admin" is where an operational account goes (docs/ARCHITECTURE.md §22.1, §13). Staff can hold a session from
   * this form — it is the same identity table and the same password — but they are routed to the portal, never
   * into onboarding and never into the dating app, and no Profile is created for them on the way.
   */
  destination: "verify-email" | "onboarding" | "app" | "admin";
}

/**
 * Verifies a password. One generic failure covers an unknown address, a wrong password and an identity with no
 * password, so nothing here tells a visitor which addresses exist. A correct password whose verifier used older
 * parameters is transparently re-hashed.
 */
export async function signInWithEmail(input: { email: string; password: string }, deps: EmailAuthDeps): Promise<EmailAuthResult<EmailSignInOutcome>> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const perEmail = await consumeRateLimit(db, `auth:login:email:${input.email}`, EMAIL_AUTH_RULES.loginAttemptsPerEmail, EMAIL_AUTH_RULES.loginWindowMs, now);
  const perClient = deps.clientKey ? await consumeRateLimit(db, `auth:login:client:${deps.clientKey}`, EMAIL_AUTH_RULES.loginAttemptsPerClient, EMAIL_AUTH_RULES.loginWindowMs, now) : { allowed: true };
  if (!perEmail.allowed || !perClient.allowed) return fail("RATE_LIMITED", GENERIC_RATE_LIMIT);

  const identity = await db.authIdentity.findUnique({
    where: { provider_providerSubject: { provider: PROVIDER, providerSubject: input.email } },
    select: { id: true, userId: true, passwordHash: true, emailVerified: true, releasedAt: true, user: { select: { accountType: true, status: true, onboardingCompletedAt: true } } },
  });
  const check = await verifyPassword(input.password, identity?.passwordHash ?? null);
  if (!identity || !check.ok || identity.releasedAt !== null) {
    return fail("INVALID_CREDENTIALS", "That email and password don't match an account.");
  }
  const { user } = identity;
  if (user.status === "DELETED") return fail("INVALID_CREDENTIALS", "That email and password don't match an account.");
  if (user.status === "SUSPENDED" || user.status === "BANNED") return fail("UNAVAILABLE", "This account isn't available.");

  if (check.needsRehash) {
    const passwordHash = await hashPassword(input.password);
    await db.authIdentity.update({ where: { id: identity.id }, data: { passwordHash } });
  }
  await Promise.all([
    db.authIdentity.update({ where: { id: identity.id }, data: { lastLoginAt: now } }),
    db.user.update({ where: { id: identity.userId }, data: { lastActiveAt: now } }),
  ]);
  const destination = user.accountType === "STAFF" ? "admin" : !identity.emailVerified ? "verify-email" : user.onboardingCompletedAt ? "app" : "onboarding";
  return { ok: true, value: { userId: identity.userId, emailVerified: identity.emailVerified, destination } };
}

// ───────────────────────────── Password reset ─────────────────────────────

/**
 * Starts "forgot password". Always succeeds from the caller's point of view, whatever the address is, so the
 * response cannot be used to discover accounts. A link is sent only to an address that really has a password.
 */
export async function requestPasswordReset(email: string, deps: EmailAuthDeps): Promise<EmailAuthResult> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const provider = deps.email ?? getEmailProvider();
  const perEmail = await consumeRateLimit(db, `auth:reset:email:${email}`, EMAIL_AUTH_RULES.resetRequestsPerEmailHour, 3_600_000, now);
  const perClient = deps.clientKey ? await consumeRateLimit(db, `auth:reset:client:${deps.clientKey}`, EMAIL_AUTH_RULES.resetRequestsPerClientHour, 3_600_000, now) : { allowed: true };
  // Even a rate-limited request answers "ok": a different answer would itself distinguish addresses.
  if (!perEmail.allowed || !perClient.allowed) return { ok: true };

  const identity = await db.authIdentity.findUnique({
    where: { provider_providerSubject: { provider: PROVIDER, providerSubject: email } },
    select: { id: true, email: true, passwordHash: true, releasedAt: true, user: { select: { accountType: true, status: true } } },
  });
  if (!identity || !identity.passwordHash || identity.releasedAt !== null || identity.user.status === "DELETED" || identity.user.status === "BANNED") return { ok: true };
  // Staff use the portal's own "forgot password". Answering identically keeps both flows non-enumerating.
  if (identity.user.accountType === "STAFF") return { ok: true };

  const { token } = await issueAuthToken(db, { identityId: identity.id, purpose: "PASSWORD_RESET" }, now);
  await deliver(provider, identity.email ?? email, passwordResetEmail(resetUrl(token), TOKEN_TTL_MS.PASSWORD_RESET / 60_000));
  return { ok: true };
}

/**
 * Completes a reset: consumes the single-use token, stores a new verifier, invalidates every outstanding reset
 * token and signs every existing session out — if the password was reset because someone else had it, their
 * sessions must end too.
 */
export async function resetPassword(input: { token: string; password: string }, deps: EmailAuthDeps): Promise<EmailAuthResult<{ userId: string }>> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const weak = validatePassword(input.password);
  if (weak) return fail("WEAK_PASSWORD", weak.message, "password");
  const consumed = await consumeAuthToken(db, input.token, "PASSWORD_RESET", now);
  if (!consumed) return fail("INVALID_TOKEN", "That reset link has expired or has already been used. Ask for a new one.");
  const identity = await db.authIdentity.findUnique({ where: { id: consumed.identityId }, select: { id: true, userId: true, provider: true, user: { select: { accountType: true, status: true } } } });
  if (!identity || identity.provider !== PROVIDER || identity.user.status === "DELETED") {
    return fail("INVALID_TOKEN", "That reset link has expired or has already been used. Ask for a new one.");
  }
  // A staff credential is reset through the portal, not here. Both flows write the same kind of token, so each one
  // checks the account domain: this keeps a member reset from touching an operational password, and it is also why
  // a reset can never confer staff access — it changes a password and nothing else (§27).
  if (identity.user.accountType === "STAFF") {
    return fail("INVALID_TOKEN", "That reset link has expired or has already been used. Ask for a new one.");
  }
  const passwordHash = await hashPassword(input.password);
  await db.authIdentity.update({ where: { id: identity.id }, data: { passwordHash, passwordUpdatedAt: now } });
  await db.authToken.updateMany({ where: { identityId: identity.id, purpose: "PASSWORD_RESET", consumedAt: null }, data: { consumedAt: now } });
  await revokeAllSessions(db, identity.userId);
  return { ok: true, value: { userId: identity.userId } };
}

// ───────────────────────────── Re-authentication ─────────────────────────────

/**
 * The email account's equivalent of signing in with Google or Telegram again before a destructive action: the
 * password is confirmed and the mark is written on this session only (§4.4). Rate-limited per session.
 */
export async function reauthenticateWithPassword(input: { sessionId: string; userId: string; password: string }, deps: EmailAuthDeps): Promise<EmailAuthResult> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const limit = await consumeRateLimit(db, `auth:reauth:${input.sessionId}`, EMAIL_AUTH_RULES.reauthAttempts, EMAIL_AUTH_RULES.reauthWindowMs, now);
  if (!limit.allowed) return fail("RATE_LIMITED", GENERIC_RATE_LIMIT);
  const identity = await db.authIdentity.findFirst({ where: { userId: input.userId, provider: PROVIDER, releasedAt: null }, select: { passwordHash: true } });
  if (!identity) return fail("UNAVAILABLE", "This account doesn't sign in with a password.");
  const check = await verifyPassword(input.password, identity.passwordHash);
  if (!check.ok) return fail("INVALID_CREDENTIALS", "That password isn't right.");
  const updated = await db.session.updateMany({ where: { id: input.sessionId, userId: input.userId }, data: { reauthenticatedAt: now } });
  if (updated.count !== 1) return fail("UNAVAILABLE", "Your session changed. Open Settings again and retry.");
  return { ok: true };
}

/** Owner-facing state for the "Verify your email" screen. */
export async function getEmailVerificationState(db: DbLike, userId: string): Promise<{ email: string; verified: boolean } | null> {
  const identity = await db.authIdentity.findFirst({ where: { userId, provider: PROVIDER, releasedAt: null }, select: { email: true, emailVerified: true } });
  return identity?.email ? { email: identity.email, verified: identity.emailVerified } : null;
}

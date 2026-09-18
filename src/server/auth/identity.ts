/**
 * Maps a verified sign-in identity to our User (docs/ARCHITECTURE.md §4.1). The identity is (provider, subject):
 * Google `sub` or Telegram user id. Providers are never linked to each other by name, username or email; the same
 * person signing in with Google and with Telegram has two accounts unless a future explicit linking step says
 * otherwise.
 *  - Unknown subject → a new ONBOARDING account plus its identity row (race-safe on the unique subject).
 *  - Known subject → the same User.id every time; the identity's email/name/username refresh from the token.
 *  - Suspended or banned → unavailable, no session.
 *  - Deleted → the caller shows the "previous account deleted" screen; only an explicit choice creates a fresh
 *    account, and the deleted profile is never revived (§4.4).
 * Re-authentication marks the current session as freshly authenticated only if the token is for the same identity.
 */
import type { Db, DbLike } from "@/lib/db";
import { InvalidStateError } from "@/lib/errors";
import type { VerifiedClaims } from "./jwt";
import { PROVIDER_ENUM, type SignInProvider } from "./oidc";
import { createAccount } from "@/server/users/account";

export type SignInOutcome =
  | { kind: "signed-in"; userId: string; destination: "onboarding" | "app"; isNewAccount: boolean }
  | { kind: "deleted"; subject: string }
  | { kind: "unavailable" };

const identityData = (claims: VerifiedClaims) => ({ email: claims.email, emailVerified: claims.emailVerified, displayName: claims.name, providerUsername: claims.username });

export async function signInWithIdentity(db: Db, provider: SignInProvider, claims: VerifiedClaims, now: Date = new Date()): Promise<SignInOutcome> {
  const key = { provider_providerSubject: { provider: PROVIDER_ENUM[provider], providerSubject: claims.subject } };
  const identity = await db.authIdentity.findUnique({
    where: key,
    select: { id: true, user: { select: { id: true, status: true, onboardingCompletedAt: true } } },
  });
  if (!identity) {
    try {
      const outcome = await db.$transaction(async (tx) => {
        const account = await createAccount(tx, now);
        await tx.authIdentity.create({
          data: { userId: account.id, provider: PROVIDER_ENUM[provider], providerSubject: claims.subject, ...identityData(claims), createdAt: now, lastLoginAt: now },
        });
        return account;
      });
      return { kind: "signed-in", userId: outcome.id, destination: "onboarding", isNewAccount: true };
    } catch (e) {
      // Lost a race with a concurrent first sign-in for the same subject: use the winner's account.
      const winner = await db.authIdentity.findUnique({ where: key, select: { id: true, user: { select: { id: true, status: true, onboardingCompletedAt: true } } } });
      if (!winner) throw e;
      return finishSignIn(db, winner, claims, now);
    }
  }
  return finishSignIn(db, identity, claims, now);
}

async function finishSignIn(db: DbLike, identity: { id: string; user: { id: string; status: string; onboardingCompletedAt: Date | null } }, claims: VerifiedClaims, now: Date): Promise<SignInOutcome> {
  const { user } = identity;
  if (user.status === "DELETED") return { kind: "deleted", subject: claims.subject };
  if (user.status === "SUSPENDED" || user.status === "BANNED") return { kind: "unavailable" };
  await Promise.all([
    db.authIdentity.update({ where: { id: identity.id }, data: { lastLoginAt: now, ...identityData(claims) } }),
    db.user.update({ where: { id: user.id }, data: { lastActiveAt: now } }),
  ]);
  return { kind: "signed-in", userId: user.id, destination: user.onboardingCompletedAt ? "app" : "onboarding", isNewAccount: false };
}

/**
 * The explicit "start a new account" choice after a deleted account signs in again. The identity row moves to a
 * brand-new User; the deleted User keeps its anonymised row and safety records. Refused unless the identity's
 * current account really is deleted.
 */
export async function createFreshAccountForIdentity(db: Db, provider: SignInProvider, claims: Pick<VerifiedClaims, "subject" | "email" | "name" | "emailVerified" | "username">, now: Date = new Date()): Promise<{ userId: string; previousUserId: string }> {
  return db.$transaction(async (tx) => {
    const identity = await tx.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: PROVIDER_ENUM[provider], providerSubject: claims.subject } },
      select: { id: true, userId: true, user: { select: { status: true } } },
    });
    if (!identity || identity.user.status !== "DELETED") throw new InvalidStateError("This identity is not attached to a deleted account");
    const account = await createAccount(tx, now);
    await tx.authIdentity.update({ where: { id: identity.id }, data: { userId: account.id, email: claims.email, emailVerified: claims.emailVerified, displayName: claims.name ?? null, providerUsername: claims.username ?? null, releasedAt: null, lastLoginAt: now } });
    await tx.auditLog.create({ data: { actorId: account.id, action: "account.recreated", targetType: "User", targetId: account.id, data: { previousUserId: identity.userId }, createdAt: now } });
    return { userId: account.id, previousUserId: identity.userId };
  });
}

/** Marks `sessionId` as freshly authenticated iff the token belongs to the session user's identity (same provider and subject). */
export async function recordReauthentication(db: DbLike, input: { sessionId: string; userId: string; provider: SignInProvider; claims: VerifiedClaims }, now: Date = new Date()): Promise<boolean> {
  const identity = await db.authIdentity.findUnique({
    where: { provider_providerSubject: { provider: PROVIDER_ENUM[input.provider], providerSubject: input.claims.subject } },
    select: { userId: true },
  });
  if (!identity || identity.userId !== input.userId) return false;
  const updated = await db.session.updateMany({ where: { id: input.sessionId, userId: input.userId }, data: { reauthenticatedAt: now } });
  return updated.count > 0;
}

export interface SignInIdentityView {
  provider: SignInProvider;
  /** Google email, or null for Telegram. */
  email: string | null;
  name: string | null;
  /** Telegram @username without the @, when the person has one. */
  username: string | null;
}

/** Owner-facing view of how they sign in (never the provider subject). */
export async function getSignInIdentity(db: DbLike, userId: string): Promise<SignInIdentityView | null> {
  const row = await db.authIdentity.findFirst({ where: { userId, releasedAt: null }, orderBy: { createdAt: "asc" }, select: { provider: true, email: true, displayName: true, providerUsername: true } });
  if (!row) return null;
  return { provider: row.provider === "TELEGRAM" ? "telegram" : "google", email: row.email, name: row.displayName, username: row.providerUsername };
}

/** "you@example.com" for Google, "@name" or the display name for Telegram: what the person recognises as their account. */
export function describeSignInIdentity(identity: Pick<SignInIdentityView, "provider" | "email" | "name" | "username"> | null): string | null {
  if (!identity) return null;
  if (identity.provider === "google") return identity.email;
  return identity.username ? `@${identity.username}` : identity.name;
}

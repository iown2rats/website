/**
 * Maps a verified sign-in identity to our User (docs/ARCHITECTURE.md §4.1).
 *  - Unknown subject → a new ONBOARDING account plus its identity row (race-safe on the unique subject).
 *  - Known subject → the same User.id every time; the identity's email/name refresh from the token.
 *  - Suspended or banned → unavailable, no session.
 *  - Deleted → the caller shows the "previous account deleted" screen; only an explicit choice creates a fresh
 *    account, and the deleted profile is never revived (§4.4).
 * Re-authentication marks the current session as freshly authenticated only if the token is for the same identity.
 */
import type { Db, DbLike } from "@/lib/db";
import { InvalidStateError } from "@/lib/errors";
import type { VerifiedClaims } from "./jwt";
import { createAccount } from "@/server/users/account";

export type SignInOutcome =
  | { kind: "signed-in"; userId: string; destination: "onboarding" | "app"; isNewAccount: boolean }
  | { kind: "deleted"; subject: string }
  | { kind: "unavailable" };

const PROVIDER = "GOOGLE" as const;

export async function signInWithIdentity(db: Db, claims: VerifiedClaims, now: Date = new Date()): Promise<SignInOutcome> {
  const identity = await db.authIdentity.findUnique({
    where: { provider_providerSubject: { provider: PROVIDER, providerSubject: claims.subject } },
    select: { id: true, user: { select: { id: true, status: true, onboardingCompletedAt: true } } },
  });
  if (!identity) {
    try {
      const outcome = await db.$transaction(async (tx) => {
        const account = await createAccount(tx, now);
        await tx.authIdentity.create({
          data: { userId: account.id, provider: PROVIDER, providerSubject: claims.subject, email: claims.email, emailVerified: claims.emailVerified, displayName: claims.name, createdAt: now, lastLoginAt: now },
        });
        return account;
      });
      return { kind: "signed-in", userId: outcome.id, destination: "onboarding", isNewAccount: true };
    } catch (e) {
      // Lost a race with a concurrent first sign-in for the same subject: use the winner's account.
      const winner = await db.authIdentity.findUnique({ where: { provider_providerSubject: { provider: PROVIDER, providerSubject: claims.subject } }, select: { id: true, user: { select: { id: true, status: true, onboardingCompletedAt: true } } } });
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
    db.authIdentity.update({ where: { id: identity.id }, data: { lastLoginAt: now, email: claims.email, emailVerified: claims.emailVerified, displayName: claims.name } }),
    db.user.update({ where: { id: user.id }, data: { lastActiveAt: now } }),
  ]);
  return { kind: "signed-in", userId: user.id, destination: user.onboardingCompletedAt ? "app" : "onboarding", isNewAccount: false };
}

/**
 * The explicit "start a new account" choice after a deleted account signs in again. The identity row moves to a
 * brand-new User; the deleted User keeps its anonymised row and safety records. Refused unless the identity's
 * current account really is deleted.
 */
export async function createFreshAccountForIdentity(db: Db, claims: Pick<VerifiedClaims, "subject" | "email" | "name" | "emailVerified">, now: Date = new Date()): Promise<{ userId: string; previousUserId: string }> {
  return db.$transaction(async (tx) => {
    const identity = await tx.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: PROVIDER, providerSubject: claims.subject } },
      select: { id: true, userId: true, user: { select: { status: true } } },
    });
    if (!identity || identity.user.status !== "DELETED") throw new InvalidStateError("This identity is not attached to a deleted account");
    const account = await createAccount(tx, now);
    await tx.authIdentity.update({ where: { id: identity.id }, data: { userId: account.id, email: claims.email, emailVerified: claims.emailVerified, displayName: claims.name ?? null, releasedAt: null, lastLoginAt: now } });
    await tx.auditLog.create({ data: { actorId: account.id, action: "account.recreated", targetType: "User", targetId: account.id, data: { previousUserId: identity.userId }, createdAt: now } });
    return { userId: account.id, previousUserId: identity.userId };
  });
}

/** Marks `sessionId` as freshly authenticated iff the token belongs to the session user's identity. */
export async function recordReauthentication(db: DbLike, input: { sessionId: string; userId: string; claims: VerifiedClaims }, now: Date = new Date()): Promise<boolean> {
  const identity = await db.authIdentity.findUnique({
    where: { provider_providerSubject: { provider: PROVIDER, providerSubject: input.claims.subject } },
    select: { userId: true },
  });
  if (!identity || identity.userId !== input.userId) return false;
  const updated = await db.session.updateMany({ where: { id: input.sessionId, userId: input.userId }, data: { reauthenticatedAt: now } });
  return updated.count > 0;
}

/** Owner-facing view of how they sign in (never the provider subject). */
export async function getSignInIdentity(db: DbLike, userId: string): Promise<{ email: string; name: string | null } | null> {
  const row = await db.authIdentity.findFirst({ where: { userId, provider: PROVIDER }, select: { email: true, displayName: true } });
  return row ? { email: row.email, name: row.displayName } : null;
}

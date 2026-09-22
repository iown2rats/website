/**
 * Claiming a staff invitation and setting a staff password (docs/ARCHITECTURE.md §22.2).
 *
 * This is the only way a STAFF account comes into existence, and it is deliberately not the member registration
 * path. `createStaffAccount` writes a User row and nothing else: no Profile, no PrivacySettings, no
 * DiscoveryPreferences, no Verification. Compare `src/server/users/account.ts`, which creates all four for a
 * member. That difference is the whole point — a staff account is not a dating account with things switched off,
 * it is an account the dating tables never knew about.
 *
 * Email ownership: the invitation token was sent to the authorised address and nowhere else, so presenting it is
 * the proof of control. Nothing here links an identity by matching email text. In particular a Google or Telegram
 * identity that happens to carry the same address is never adopted, and an address that already belongs to a
 * dating MEMBER is refused outright — converting a member is an administrator's explicit decision, never a side
 * effect of somebody clicking a link.
 */
import type { Db, DbLike } from "@/lib/db";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { hashPassword, validatePassword } from "@/server/auth/password";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { consumeStaffInvite, peekStaffInvite } from "./invites";
import { findOpenStaffGrant } from "./live-grant";
import { isStaffRole, STAFF_RULES, type StaffRole } from "./rules";

const EMAIL_PROVIDER = "EMAIL" as const;

export type ClaimResult =
  | { ok: true; userId: string; email: string; role: StaffRole; created: boolean }
  | {
      ok: false;
      code: "INVALID_TOKEN" | "WEAK_PASSWORD" | "RATE_LIMITED" | "MEMBER_ACCOUNT" | "ALREADY_STAFF";
      message: string;
      /** Only on RATE_LIMITED: when the window resets, so the form can show a real cooldown instead of guessing. */
      retryAt?: Date;
    };

const INVALID = {
  ok: false as const,
  code: "INVALID_TOKEN" as const,
  message: "That invitation link has expired or has already been used. Ask an administrator for a new one.",
};

export interface ClaimDeps {
  db: Db;
  now?: Date;
  clientKey?: string | null;
}

/** What the set-password page shows before the visitor commits. Null for anything unusable. */
export async function describeInvite(db: DbLike, token: string, now: Date = new Date()): Promise<{ email: string; role: StaffRole; setup: boolean } | null> {
  const view = await peekStaffInvite(db, token, now);
  if (!view || !isStaffRole(view.role)) return null;
  return { email: view.email, role: view.role, setup: view.status === "PENDING" };
}

/**
 * Creates a STAFF account: a User row and nothing from the dating domain. Not exported beyond this module and the
 * tests, so there is exactly one way a staff account can be born.
 */
export async function createStaffAccount(tx: DbLike, role: StaffRole, now: Date): Promise<{ id: string }> {
  return tx.user.create({
    data: {
      accountType: "STAFF",
      role,
      status: "ACTIVE",
      // A staff account never enters onboarding. Leaving `onboardingCompletedAt` null also means the discovery
      // predicate's onboarding test excludes it, on top of the account-type test.
      onboardingStage: "NAME",
      onboardingCompletedAt: null,
      lastActiveAt: now,
      createdAt: now,
    },
    select: { id: true },
  });
}

/**
 * Claims an invitation: establishes the password, creates or attaches the STAFF account and flips the grant to
 * ACTIVE. Also serves the "set your admin password" case for a grant that is already ACTIVE and bound to an
 * account, which is how an existing administrator establishes their first portal password.
 */
export async function claimStaffInvite(input: { token: string; password: string }, deps: ClaimDeps): Promise<ClaimResult> {
  const { db } = deps;
  const now = deps.now ?? new Date();

  if (deps.clientKey) {
    const limit = await consumeRateLimit(db, `staff:claim:${deps.clientKey}`, STAFF_RULES.claimAttemptsPerClientHour, 3_600_000, now);
    if (!limit.allowed) {
      return { ok: false, code: "RATE_LIMITED", message: "Too many attempts. Try again in a little while.", retryAt: limit.retryAt };
    }
  }

  const weak = validatePassword(input?.password ?? "");
  if (weak) return { ok: false, code: "WEAK_PASSWORD", message: weak.message };

  // Look before consuming, so a refusal does not burn the link.
  const preview = await peekStaffInvite(db, input.token, now);
  if (!preview || !isStaffRole(preview.role)) return INVALID;

  const collision = await db.authIdentity.findUnique({
    where: { provider_providerSubject: { provider: EMAIL_PROVIDER, providerSubject: preview.email } },
    select: { id: true, userId: true, releasedAt: true, user: { select: { accountType: true, status: true } } },
  });
  const boundUserId = preview.status === "ACTIVE" ? preview.claimedByUserId : null;
  if (collision && collision.user.status !== "DELETED" && collision.releasedAt === null) {
    const isTheBoundAccount = boundUserId !== null && collision.userId === boundUserId;
    if (collision.user.accountType === "MEMBER" && !isTheBoundAccount) {
      await writeAudit(db, {
        actorId: null,
        action: AUDIT_ACTIONS.staffInviteRejected,
        targetType: "StaffGrant",
        targetId: preview.grantId,
        data: { refused: "address-belongs-to-member", email: preview.email },
        now,
      });
      return {
        ok: false,
        code: "MEMBER_ACCOUNT",
        message: "That address already has a Mellocrush member account. An administrator has to convert it before it can be staff.",
      };
    }
  }

  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin:roles'))`;
    const grant = await consumeStaffInvite(tx, input.token, now);
    if (!grant || !isStaffRole(grant.role)) return INVALID;

    // ── Case 1: an already-active grant setting or replacing its password. ───────────────────────────────────
    if (grant.status === "ACTIVE" && grant.claimedByUserId) {
      const userId = grant.claimedByUserId;
      await upsertStaffPassword(tx, userId, grant.email, passwordHash, now);
      await tx.session.deleteMany({ where: { userId } });
      await writeAudit(tx, {
        actorId: userId,
        action: AUDIT_ACTIONS.staffPasswordSet,
        targetType: "User",
        targetId: userId,
        data: { via: "invite", grantId: grant.grantId },
        now,
      });
      return { ok: true as const, userId, email: grant.email, role: grant.role, created: false };
    }

    if (grant.status !== "PENDING") return INVALID;

    // ── Case 2: a pending grant. Re-check the collision inside the transaction. ─────────────────────────────
    const existing = await tx.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: EMAIL_PROVIDER, providerSubject: grant.email } },
      select: { id: true, userId: true, releasedAt: true, user: { select: { accountType: true, status: true } } },
    });
    let userId: string;
    let created = false;
    if (existing && existing.user.status !== "DELETED" && existing.releasedAt === null) {
      if (existing.user.accountType === "MEMBER") {
        return {
          ok: false as const,
          code: "MEMBER_ACCOUNT" as const,
          message: "That address already has a Mellocrush member account. An administrator has to convert it before it can be staff.",
        };
      }
      userId = existing.userId;
      await tx.authIdentity.update({
        where: { id: existing.id },
        data: { passwordHash, passwordUpdatedAt: now, emailVerified: true, email: grant.email, lastLoginAt: now },
      });
      await tx.user.update({ where: { id: userId }, data: { accountType: "STAFF", role: grant.role, status: "ACTIVE" } });
    } else {
      const account = await createStaffAccount(tx, grant.role, now);
      userId = account.id;
      created = true;
      await tx.authIdentity.create({
        data: {
          userId,
          provider: EMAIL_PROVIDER,
          providerSubject: grant.email,
          email: grant.email,
          // The invitation went to this address and nowhere else; presenting the token is the proof of control.
          emailVerified: true,
          passwordHash,
          passwordUpdatedAt: now,
          createdAt: now,
          lastLoginAt: now,
        },
      });
    }

    /*
     * One live grant per account. A REVOKED grant does not reserve the account — that is the whole point of the
     * partial index `StaffGrant_claimedBy_open_key`, and it is what lets a revoked colleague be re-invited and
     * claim the invitation onto the account they already have. What is still refused is binding a second OPEN
     * grant to one account, and it is refused here with a sentence rather than left to surface as a unique
     * violation, because a crash on this path tells the visitor nothing at all.
     */
    const alreadyOpen = await findOpenStaffGrant(tx, userId);
    if (alreadyOpen && alreadyOpen.id !== grant.grantId) {
      return {
        ok: false as const,
        code: "ALREADY_STAFF" as const,
        message: "That account already has a staff authorisation. Ask an administrator to revoke the old one first.",
      };
    }

    await tx.staffGrant.update({
      where: { id: grant.grantId },
      data: { status: "ACTIVE", claimedByUserId: userId, claimedAt: now },
    });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, { actorId: userId, action: AUDIT_ACTIONS.staffClaimed, targetType: "StaffGrant", targetId: grant.grantId, data: { email: grant.email, role: grant.role, created }, now });
    await writeAudit(tx, { actorId: userId, action: AUDIT_ACTIONS.staffActivated, targetType: "User", targetId: userId, data: { role: grant.role, grantId: grant.grantId }, now });
    await writeAudit(tx, { actorId: userId, action: AUDIT_ACTIONS.staffPasswordSet, targetType: "User", targetId: userId, data: { via: "invite", grantId: grant.grantId }, now });
    return { ok: true as const, userId, email: grant.email, role: grant.role, created };
  });
}

/** Creates the EMAIL identity for a staff account, or refreshes the password on the one it already has. */
async function upsertStaffPassword(tx: DbLike, userId: string, email: string, passwordHash: string, now: Date): Promise<void> {
  const identity = await tx.authIdentity.findFirst({
    where: { userId, provider: EMAIL_PROVIDER, releasedAt: null },
    select: { id: true },
  });
  if (identity) {
    await tx.authIdentity.update({ where: { id: identity.id }, data: { passwordHash, passwordUpdatedAt: now, emailVerified: true, email } });
    return;
  }
  await tx.authIdentity.create({
    data: {
      userId,
      provider: EMAIL_PROVIDER,
      providerSubject: email,
      email,
      emailVerified: true,
      passwordHash,
      passwordUpdatedAt: now,
      createdAt: now,
    },
  });
}

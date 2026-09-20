/**
 * Promoting an existing account to staff (docs/ARCHITECTURE.md §22.3).
 *
 * This replaces the old "change this user's role" control. Flipping a role column would have left a dating profile,
 * a discovery entry and a Community identity attached to an operator, which is the arrangement this design exists
 * to remove. Promotion is therefore always a conversion: the member-domain rows go, an ACTIVE grant is created,
 * and the person receives a link to choose an admin-portal password.
 *
 * The address is resolved from a *verified* sign-in identity on the account being promoted — never typed in by the
 * promoting admin, and never taken from an unverified one. An account whose only identity is Telegram has no email
 * the system has verified, so it cannot be promoted this way at all (§11).
 */
import type { Db } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { assertPermission, type AdminActor } from "@/server/admin/authz";
import { convertToStaff, inventoryMemberData, planConversion, type ConversionPlan } from "./conversion";
import { issueStaffInvite } from "./invites";
import { isStaffRole, normalizeStaffEmail, validateReason, type StaffRole } from "./rules";

export interface PromotionPreview {
  userId: string;
  email: string | null;
  /** Why the account cannot be promoted, when it cannot. */
  blockedReason: string | null;
  plan: ConversionPlan;
}

/**
 * Read-only: what promoting this account would do. The admin UI shows this before asking for confirmation, and the
 * production conversion script prints it.
 */
export async function previewPromotion(db: Db, userId: string): Promise<PromotionPreview> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, accountType: true, status: true,
      identities: { where: { releasedAt: null }, select: { provider: true, email: true, emailVerified: true } },
    },
  });
  if (!user) throw new NotFoundError("User");
  const inventory = await inventoryMemberData(db, userId);
  const plan = planConversion(inventory);
  const email = verifiedEmailOf(user.identities);
  let blockedReason: string | null = null;
  if (user.accountType === "STAFF") blockedReason = "This account is already staff.";
  else if (user.status === "DELETED") blockedReason = "A deleted account can't become staff.";
  else if (!email) blockedReason = "This account has no verified email address, so it can't hold staff access.";
  else if (!plan.canProceed) blockedReason = `This account has dating history that must be handled first: ${plan.blockers.map((b) => `${b.what} (${b.count})`).join(", ")}.`;
  return { userId, email, blockedReason, plan };
}

/** The address of a sign-in identity the system has actually verified. Telegram identities carry none. */
function verifiedEmailOf(identities: { provider: string; email: string | null; emailVerified: boolean }[]): string | null {
  for (const i of identities) {
    if (!i.email || !i.emailVerified) continue;
    if (i.provider !== "GOOGLE" && i.provider !== "EMAIL") continue;
    const email = normalizeStaffEmail(i.email);
    if (email) return email;
  }
  return null;
}

export interface PromotionResult {
  userId: string;
  email: string;
  role: StaffRole;
  grantId: string;
  /** Raw set-password token for the email. Never persisted, never audited. */
  token: string;
  expiresAt: Date;
  /** Storage objects the caller must delete once the transaction has committed. */
  orphanedStorageKeys: string[];
}

export interface PromoteOptions {
  role: StaffRole;
  reason: string;
  now?: Date;
  via?: "admin" | "cli" | "bootstrap";
  /** Who is doing this; null for an operator running the CLI. Checked against self-promotion by the caller. */
  actorId: string | null;
  /**
   * Bootstrap only: succeed only while no administrator exists. Re-checked inside the transaction under the same
   * advisory lock, so two simultaneous first-admin claims cannot both win.
   */
  requireNoExistingAdmin?: boolean;
}

/**
 * Converts an account to STAFF and gives it a live grant, in one transaction under the `admin:roles` lock. Returns
 * the raw set-password token so the caller can email it; nothing about the token is written to the audit log.
 */
export async function promoteAccountToStaff(db: Db, userId: string, options: PromoteOptions): Promise<PromotionResult> {
  const now = options.now ?? new Date();
  if (!isStaffRole(options.role)) throw new ValidationError("Choose a staff role.");
  const reason = validateReason(options.reason);
  if (!reason.ok) throw new ValidationError(reason.message);
  if (options.actorId && options.actorId === userId && !options.requireNoExistingAdmin) {
    throw new InvalidStateError("You can't change your own access.");
  }

  const preview = await previewPromotion(db, userId);
  if (preview.blockedReason) throw new InvalidStateError(preview.blockedReason);
  const email = preview.email;
  if (!email) throw new InvalidStateError("This account has no verified email address, so it can't hold staff access.");

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin:roles'))`;

    if (options.requireNoExistingAdmin) {
      const admins = await tx.staffGrant.count({
        where: { status: "ACTIVE", role: "ADMIN", claimedBy: { accountType: "STAFF", status: { notIn: ["DELETED", "BANNED"] } } },
      });
      if (admins > 0) throw new InvalidStateError("An administrator already exists.");
    }

    const open = await tx.staffGrant.findFirst({ where: { email, status: { not: "REVOKED" } }, select: { id: true } });
    if (open) throw new InvalidStateError("That address already has a staff authorisation.");

    const conversion = await convertToStaff(tx, userId, { role: options.role, actorId: options.actorId, now, via: options.via ?? "admin" });

    const grant = await tx.staffGrant.create({
      data: {
        email,
        role: options.role,
        reason: reason.reason,
        status: "ACTIVE",
        createdById: options.actorId,
        claimedByUserId: userId,
        claimedAt: now,
        createdAt: now,
      },
      select: { id: true },
    });
    const invite = await issueStaffInvite(tx, { grantId: grant.id, createdById: options.actorId }, now);

    await writeAudit(tx, {
      actorId: options.actorId,
      action: AUDIT_ACTIONS.staffActivated,
      targetType: "User",
      targetId: userId,
      data: { role: options.role, grantId: grant.id, email, reason: reason.reason, via: options.via ?? "admin" },
      now,
    });

    return {
      userId,
      email,
      role: options.role,
      grantId: grant.id,
      token: invite.token,
      expiresAt: invite.expiresAt,
      orphanedStorageKeys: conversion.orphanedStorageKeys,
    };
  });
}

/** The admin-facing entry point: permission-checked, self-promotion refused. */
export async function promoteMemberToStaff(admin: AdminActor, userId: string, input: { role: StaffRole; reason: string }, deps: { db: Db; now?: Date }): Promise<PromotionResult> {
  assertPermission(admin, "users.role");
  if (admin.userId === String(userId)) throw new InvalidStateError("You can't change your own access.");
  return promoteAccountToStaff(deps.db, String(userId), {
    role: input?.role,
    reason: input?.reason,
    now: deps.now,
    via: "admin",
    actorId: admin.userId,
  });
}

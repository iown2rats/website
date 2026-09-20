/**
 * Staff authorisation lifecycle (docs/ARCHITECTURE.md §22.2): PENDING → ACTIVE → REVOKED.
 *
 * A grant is the single source of truth for "may this account use the admin portal". `requireStaff()` reads it on
 * every request, so revoking one closes the door at once — there is no cached capability to wait out. Three rules
 * hold throughout:
 *
 *  - **One open grant per address.** Enforced by a partial unique index (`StaffGrant_email_open_key`), so two
 *    admins racing to authorise the same person cannot both win. A REVOKED row is history and does not reserve
 *    the address.
 *  - **Mellocrush always keeps an administrator.** Every operation that could reduce the number of live admins
 *    takes the `admin:roles` advisory lock and re-counts inside the transaction, so two concurrent revocations
 *    cannot both pass the check and leave zero.
 *  - **Nobody edits their own authority.** An admin cannot revoke or demote their own grant, which is what stops
 *    the one administrator locking themselves out by accident.
 */
import type { Db, DbLike } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { assertPermission, type AdminActor } from "@/server/admin/authz";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { isPlausibleEmail, isStaffRole, normalizeStaffEmail, STAFF_RULES, validateReason, type StaffRole } from "./rules";

export type StaffGrantStatus = "PENDING" | "ACTIVE" | "REVOKED";

export interface StaffGrantRow {
  id: string;
  email: string;
  role: StaffRole;
  reason: string;
  status: StaffGrantStatus;
  createdAt: Date;
  createdByEmail: string | null;
  claimedByUserId: string | null;
  claimedAt: Date | null;
  revokedAt: Date | null;
  /** When the newest unspent invitation expires, for the pending table. Null when none is outstanding. */
  inviteExpiresAt: Date | null;
}

/**
 * How many live administrators exist. The definition that matters everywhere: a STAFF account, not deleted, whose
 * grant is ACTIVE with role ADMIN. A MEMBER row whose `role` column still says ADMIN does not count, because
 * `requireStaff()` would refuse it anyway.
 */
export async function countLiveAdmins(db: DbLike): Promise<number> {
  return db.staffGrant.count({
    where: {
      status: "ACTIVE",
      role: "ADMIN",
      claimedBy: { accountType: "STAFF", status: { notIn: ["DELETED", "BANNED"] } },
    },
  });
}

/** Everything the /admin/staff screen shows. Never selects a token, a hash or a password field. */
export async function listStaffGrants(db: DbLike): Promise<StaffGrantRow[]> {
  const rows = await db.staffGrant.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true, email: true, role: true, reason: true, status: true, createdAt: true,
      claimedByUserId: true, claimedAt: true, revokedAt: true,
      createdBy: { select: { identities: { where: { releasedAt: null }, select: { email: true }, take: 1 } } },
      invites: { where: { consumedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { expiresAt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role as StaffRole,
    reason: r.reason,
    status: r.status as StaffGrantStatus,
    createdAt: r.createdAt,
    createdByEmail: r.createdBy?.identities[0]?.email ?? null,
    claimedByUserId: r.claimedByUserId,
    claimedAt: r.claimedAt,
    revokedAt: r.revokedAt,
    inviteExpiresAt: r.invites[0]?.expiresAt ?? null,
  }));
}

export interface CreateGrantInput {
  email: string;
  role: StaffRole;
  reason: string;
}

export interface CreatedGrant {
  grantId: string;
  email: string;
  role: StaffRole;
  /** Raw invitation token for the email. Never persisted, never audited. */
  token: string;
  expiresAt: Date;
}

/**
 * Authorises an address. The person does not need an account: the grant is created PENDING and an invitation is
 * issued for it. Claiming the invitation is what creates or converts the account (see claim.ts).
 */
export async function createStaffGrant(admin: AdminActor, input: CreateGrantInput, deps: { db: Db; now?: Date }): Promise<CreatedGrant> {
  assertPermission(admin, "users.role");
  const { db } = deps;
  const now = deps.now ?? new Date();

  const email = normalizeStaffEmail(input?.email);
  if (!isPlausibleEmail(email)) throw new ValidationError("Enter a valid email address.");
  if (!isStaffRole(input?.role)) throw new ValidationError("Choose a staff role.");
  const reason = validateReason(input?.reason);
  if (!reason.ok) throw new ValidationError(reason.message);

  const limit = await consumeRateLimit(db, `staff:create:${admin.userId}`, STAFF_RULES.grantsPerAdminHour, 3_600_000, now);
  if (!limit.allowed) throw new InvalidStateError("You've added a lot of staff in the last hour. Try again shortly.");

  // Issued inside the transaction so a failed insert never leaves a live token behind.
  const { issueStaffInvite } = await import("./invites");
  try {
    return await db.$transaction(async (tx) => {
      const grant = await tx.staffGrant.create({
        data: { email, role: input.role, reason: reason.reason, status: "PENDING", createdById: admin.userId, createdAt: now },
        select: { id: true },
      });
      const invite = await issueStaffInvite(tx, { grantId: grant.id, createdById: admin.userId }, now);
      await writeAudit(tx, {
        actorId: admin.userId,
        action: AUDIT_ACTIONS.staffInvited,
        targetType: "StaffGrant",
        targetId: grant.id,
        data: { email, role: input.role, reason: reason.reason, expiresAt: invite.expiresAt },
        now,
      });
      return { grantId: grant.id, email, role: input.role, token: invite.token, expiresAt: invite.expiresAt };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new InvalidStateError("That address already has a staff authorisation. Revoke it first to change it.");
    }
    throw e;
  }
}

/** Re-sends the invitation for a still-pending grant, invalidating the previous link. */
export async function resendStaffInvite(admin: AdminActor, grantId: string, deps: { db: Db; now?: Date }): Promise<CreatedGrant> {
  assertPermission(admin, "users.role");
  const { db } = deps;
  const now = deps.now ?? new Date();
  const grant = await db.staffGrant.findUnique({ where: { id: String(grantId) }, select: { id: true, email: true, role: true, status: true } });
  if (!grant) throw new NotFoundError("Staff authorisation");
  if (grant.status !== "PENDING") throw new InvalidStateError("That invitation has already been used or cancelled.");

  const last = await db.staffInvite.findFirst({ where: { grantId: grant.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && now.getTime() - last.createdAt.getTime() < STAFF_RULES.resendCooldownMs) {
    const seconds = Math.ceil((STAFF_RULES.resendCooldownMs - (now.getTime() - last.createdAt.getTime())) / 1000);
    throw new InvalidStateError(`Wait ${seconds} seconds before sending another invitation.`);
  }
  const limit = await consumeRateLimit(db, `staff:resend:${grant.id}`, STAFF_RULES.resendsPerHour, 3_600_000, now);
  if (!limit.allowed) throw new InvalidStateError("That invitation has been sent several times already. Try again in an hour.");

  const { issueStaffInvite } = await import("./invites");
  return db.$transaction(async (tx) => {
    const invite = await issueStaffInvite(tx, { grantId: grant.id, createdById: admin.userId }, now);
    await writeAudit(tx, {
      actorId: admin.userId,
      action: AUDIT_ACTIONS.staffInviteResent,
      targetType: "StaffGrant",
      targetId: grant.id,
      data: { email: grant.email, role: grant.role, expiresAt: invite.expiresAt },
      now,
    });
    return { grantId: grant.id, email: grant.email, role: grant.role as StaffRole, token: invite.token, expiresAt: invite.expiresAt };
  });
}

/** Cancels an unclaimed invitation. The address becomes free to authorise again. */
export async function cancelStaffInvite(admin: AdminActor, grantId: string, deps: { db: Db; now?: Date }): Promise<void> {
  assertPermission(admin, "users.role");
  const { db } = deps;
  const now = deps.now ?? new Date();
  const grant = await db.staffGrant.findUnique({ where: { id: String(grantId) }, select: { id: true, email: true, role: true, status: true } });
  if (!grant) throw new NotFoundError("Staff authorisation");
  if (grant.status !== "PENDING") throw new InvalidStateError("That invitation has already been used or cancelled.");
  await db.$transaction(async (tx) => {
    await tx.staffGrant.update({ where: { id: grant.id }, data: { status: "REVOKED", revokedById: admin.userId, revokedAt: now, revokedReason: "Invitation cancelled" } });
    await tx.staffInvite.updateMany({ where: { grantId: grant.id, consumedAt: null }, data: { consumedAt: now } });
    await writeAudit(tx, {
      actorId: admin.userId,
      action: AUDIT_ACTIONS.staffInviteCancelled,
      targetType: "StaffGrant",
      targetId: grant.id,
      data: { email: grant.email, role: grant.role },
      now,
    });
  });
}

/**
 * Changes the authority of a live staff account. Refuses to demote the last administrator and refuses to let
 * anyone change their own authority, both re-checked inside the transaction under the lock.
 */
export async function changeStaffRole(admin: AdminActor, grantId: string, input: { role: StaffRole; reason: string }, deps: { db: Db; now?: Date }): Promise<{ grantId: string; role: StaffRole }> {
  assertPermission(admin, "users.role");
  const { db } = deps;
  const now = deps.now ?? new Date();
  if (!isStaffRole(input?.role)) throw new ValidationError("Choose a staff role.");
  const reason = validateReason(input?.reason);
  if (!reason.ok) throw new ValidationError(reason.message);

  return auditingRefusals(db, admin, now, () =>
    db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin:roles'))`;
    const grant = await tx.staffGrant.findUnique({ where: { id: String(grantId) }, select: { id: true, email: true, role: true, status: true, claimedByUserId: true } });
    if (!grant) throw new NotFoundError("Staff authorisation");
    if (grant.status === "REVOKED") throw new InvalidStateError("That staff authorisation has been revoked.");
    if (grant.claimedByUserId && grant.claimedByUserId === admin.userId) {
      refuse(grant.id, "self-role-change", "You can't change your own access.");
    }
    if (grant.role === input.role) return { grantId: grant.id, role: input.role };
    if (grant.role === "ADMIN" && input.role !== "ADMIN" && grant.status === "ACTIVE" && (await countLiveAdmins(tx)) <= 1) {
      refuse(grant.id, "last-admin-demotion", "Mellocrush needs at least one administrator.");
    }
    await tx.staffGrant.update({ where: { id: grant.id }, data: { role: input.role } });
    // An ACTIVE grant mirrors its role onto the account, so authorisation stays a single read on the session user.
    if (grant.status === "ACTIVE" && grant.claimedByUserId) {
      await tx.user.update({ where: { id: grant.claimedByUserId }, data: { role: input.role } });
    }
    await writeAudit(tx, {
      actorId: admin.userId,
      action: AUDIT_ACTIONS.staffRoleChanged,
      targetType: "StaffGrant",
      targetId: grant.id,
      data: { email: grant.email, reason: reason.reason, before: { role: grant.role }, after: { role: input.role }, userId: grant.claimedByUserId },
      now,
    });
    return { grantId: grant.id, role: input.role };
    }),
  );
}

/**
 * Ends a staff authorisation. The account keeps existing and keeps its history; it simply stops being staff. It is
 * deliberately NOT turned back into a dating member — that needs its own explicit process — so a revoked staff
 * account has no profile, cannot be discovered and cannot use the member app either.
 */
export async function revokeStaffGrant(admin: AdminActor, grantId: string, input: { reason: string }, deps: { db: Db; now?: Date }): Promise<{ grantId: string; userId: string | null }> {
  assertPermission(admin, "users.role");
  const { db } = deps;
  const now = deps.now ?? new Date();
  const reason = validateReason(input?.reason);
  if (!reason.ok) throw new ValidationError(reason.message);

  return auditingRefusals(db, admin, now, () =>
    db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin:roles'))`;
    const grant = await tx.staffGrant.findUnique({ where: { id: String(grantId) }, select: { id: true, email: true, role: true, status: true, claimedByUserId: true } });
    if (!grant) throw new NotFoundError("Staff authorisation");
    if (grant.status === "REVOKED") throw new InvalidStateError("That staff authorisation has already been revoked.");
    if (grant.claimedByUserId && grant.claimedByUserId === admin.userId) {
      refuse(grant.id, "self-revocation", "You can't revoke your own access.");
    }
    if (grant.role === "ADMIN" && grant.status === "ACTIVE" && (await countLiveAdmins(tx)) <= 1) {
      refuse(grant.id, "last-admin-revocation", "Mellocrush needs at least one administrator.");
    }

    await tx.staffGrant.update({ where: { id: grant.id }, data: { status: "REVOKED", revokedById: admin.userId, revokedAt: now, revokedReason: reason.reason } });
    await tx.staffInvite.updateMany({ where: { grantId: grant.id, consumedAt: null }, data: { consumedAt: now } });
    if (grant.claimedByUserId) {
      // Drop the mirrored authority and end every session this account holds, so access stops immediately rather
      // than at the next sign-in.
      await tx.user.update({ where: { id: grant.claimedByUserId }, data: { role: "USER" } });
      await tx.session.deleteMany({ where: { userId: grant.claimedByUserId } });
    }
    await writeAudit(tx, {
      actorId: admin.userId,
      action: AUDIT_ACTIONS.staffRevoked,
      targetType: "StaffGrant",
      targetId: grant.id,
      data: { email: grant.email, reason: reason.reason, before: { role: grant.role, status: grant.status }, after: { status: "REVOKED" }, userId: grant.claimedByUserId },
      now,
    });
    return { grantId: grant.id, userId: grant.claimedByUserId };
    }),
  );
}

/**
 * A refused privilege change is itself worth recording: it is the signal that someone tried.
 *
 * Written *outside* the transaction that refused, and deliberately so. The refusal is an abort, and anything
 * written inside an aborted transaction disappears with it — the audit row would roll back along with the change
 * it was recording. `refuse()` therefore throws a marker, and the caller writes the row once the rollback is done.
 */
class RefusedChange extends Error {
  constructor(readonly grantId: string, readonly why: string, readonly message: string) {
    super(message);
    this.name = "RefusedChange";
  }
}

const refuse = (grantId: string, why: string, message: string): never => {
  throw new RefusedChange(grantId, why, message);
};

/** Runs a grant mutation, converting a refusal into an audited InvalidStateError after the rollback completes. */
async function auditingRefusals<T>(db: Db, admin: AdminActor, now: Date, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof RefusedChange) {
      await writeAudit(db, {
        actorId: admin.userId,
        action: AUDIT_ACTIONS.staffChangeRejected,
        targetType: "StaffGrant",
        targetId: e.grantId,
        data: { refused: e.why },
        now,
      });
      throw new InvalidStateError(e.message);
    }
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  return code === "P2002" || code === "23505";
}

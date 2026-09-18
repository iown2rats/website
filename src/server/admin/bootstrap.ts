/**
 * Admin role changes and first-admin bootstrap (docs/ARCHITECTURE.md §21.2).
 *
 * Bootstrap: the owner sets ADMIN_BOOTSTRAP_TOKEN (32+ random characters) in the server environment, signs in with
 * Google as usual, opens /admin-setup and enters the token. The claim succeeds only while NO admin exists, so
 * the mechanism switches itself off after first use; the owner then removes the variable. No email address is in
 * source, nobody becomes admin automatically, and the page 404s whenever bootstrap is not available.
 */
import { timingSafeEqual } from "node:crypto";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { AUDIT_ACTIONS, writeAudit } from "./audit";
import { assertPermission, type AdminActor } from "./authz";

export type Role = "USER" | "MODERATOR" | "ADMIN";
export const ROLES: readonly Role[] = ["USER", "MODERATOR", "ADMIN"];

export async function countAdmins(db: DbLike): Promise<number> {
  return db.user.count({ where: { role: "ADMIN", status: { not: "DELETED" } } });
}

/** ADMIN only. Never your own role; never leaves the project without an admin. */
export async function changeUserRole(admin: AdminActor, targetUserId: string, input: { role: Role; reason: string }, deps: { db?: Db; now?: Date } = {}): Promise<{ userId: string; role: Role }> {
  assertPermission(admin, "users.role");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!ROLES.includes(input?.role)) throw new ValidationError("Choose a role");
  const reason = String(input?.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 300 || /[<>]/.test(reason)) throw new ValidationError("Give a short reason (3–300 characters)");
  if (targetUserId === admin.userId) throw new InvalidStateError("You can't change your own role");
  const target = await db.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true, status: true } });
  if (!target) throw new NotFoundError("User");
  if (target.status === "DELETED") throw new InvalidStateError("Deleted accounts can't hold a role");
  if (target.role === input.role) return { userId: target.id, role: target.role };
  const updated = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin:roles'))`;
    if (target.role === "ADMIN" && (await countAdmins(tx)) <= 1) throw new InvalidStateError("Thundi needs at least one administrator");
    const row = await tx.user.update({ where: { id: target.id }, data: { role: input.role }, select: { id: true, role: true } });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.adminRoleChanged, targetType: "User", targetId: target.id, data: { reason, before: { role: target.role }, after: { role: row.role } }, now });
    return row;
  });
  return { userId: updated.id, role: updated.role };
}

function configuredToken(): string | null {
  const token = getEnv().ADMIN_BOOTSTRAP_TOKEN;
  return token && token.length >= 32 ? token : null;
}

/** True only while the token is configured AND no administrator exists yet. */
export async function isBootstrapAvailable(db: DbLike): Promise<boolean> {
  if (!configuredToken()) return false;
  return (await countAdmins(db)) === 0;
}

export type BootstrapResult = { ok: true } | { ok: false; code: "UNAVAILABLE" | "INVALID_TOKEN" | "RATE_LIMITED" | "NOT_ELIGIBLE" };

export async function bootstrapFirstAdmin(actor: Actor, token: string, deps: { db?: Db; now?: Date; token?: string | null } = {}): Promise<BootstrapResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const expected = deps.token === undefined ? configuredToken() : deps.token;
  if (!expected) return { ok: false, code: "UNAVAILABLE" };
  const limit = await consumeRateLimit(db, `admin:bootstrap:${actor.userId}`, 5, 3_600_000, now);
  if (!limit.allowed) return { ok: false, code: "RATE_LIMITED" };
  const given = Buffer.from(String(token ?? ""));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, code: "INVALID_TOKEN" };

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin:roles'))`;
    if ((await countAdmins(tx)) > 0) return { ok: false, code: "UNAVAILABLE" } as const;
    const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { id: true, role: true, status: true, onboardingCompletedAt: true } });
    if (!user || user.status !== "ACTIVE" || !user.onboardingCompletedAt) return { ok: false, code: "NOT_ELIGIBLE" } as const;
    await tx.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    await writeAudit(tx, { actorId: user.id, action: AUDIT_ACTIONS.adminBootstrapped, targetType: "User", targetId: user.id, data: { via: "bootstrap-token", before: { role: user.role }, after: { role: "ADMIN" } }, now });
    return { ok: true } as const;
  });
}

/** Used by scripts/grant-admin.ts (an operator with database access). Audited with a null actor and the CLI marker. */
export async function grantRoleFromCli(db: Db, targetUserId: string, role: Role, now: Date = new Date()): Promise<{ before: Role; after: Role }> {
  const target = await db.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true, status: true } });
  if (!target) throw new NotFoundError("User");
  if (target.status === "DELETED") throw new InvalidStateError("Deleted accounts can't hold a role");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { role } });
    await writeAudit(tx, { actorId: null, action: AUDIT_ACTIONS.adminRoleChanged, targetType: "User", targetId: target.id, data: { via: "cli", before: { role: target.role }, after: { role } }, now });
  });
  return { before: target.role, after: role };
}

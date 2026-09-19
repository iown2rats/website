/**
 * First-admin bootstrap (docs/ARCHITECTURE.md §21.2).
 *
 * The owner sets ADMIN_BOOTSTRAP_TOKEN (32+ random characters) in the server environment, signs in as usual, opens
 * /admin-setup and enters the token. The claim succeeds only while NO administrator exists, so the mechanism
 * switches itself off after first use; the owner then removes the variable. No email address is in source, nobody
 * becomes admin automatically, and the page 404s whenever bootstrap is not available.
 *
 * Since the staff split (§22.1) a successful claim does not set a role — it runs the full MEMBER → STAFF
 * conversion and issues a set-password link, exactly like any other promotion. A claimant who still has dating
 * history the conversion refuses to destroy is told so and nothing changes.
 */
import { timingSafeEqual } from "node:crypto";
import { getDb, type Db, type DbLike } from "@/lib/db";
import type { EmailProvider } from "@/lib/email";
import { sendStaffInviteEmail } from "@/server/staff/auth";
import { promoteAccountToStaff } from "@/server/staff/promote";
import { getEnv } from "@/lib/env";
import { InvalidStateError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { AUDIT_ACTIONS, writeAudit } from "./audit";

export type Role = "USER" | "MODERATOR" | "ADMIN";
export const ROLES: readonly Role[] = ["USER", "MODERATOR", "ADMIN"];

/**
 * How many administrators exist. Counts live STAFF accounts holding an ACTIVE ADMIN grant — the same definition
 * `requireStaff()` uses — so a leftover MEMBER row whose role column says ADMIN neither counts as an administrator
 * nor keeps bootstrap switched off.
 */
export async function countAdmins(db: DbLike): Promise<number> {
  return db.staffGrant.count({
    where: { status: "ACTIVE", role: "ADMIN", claimedBy: { accountType: "STAFF", status: { notIn: ["DELETED", "BANNED"] } } },
  });
}

/*
 * `changeUserRole()` used to live here: it flipped User.role for any account from the user-detail screen. It is
 * gone on purpose. Setting a role on a dating account would have produced exactly the arrangement the staff split
 * removes — an operator with a profile, a place in discovery and a Community identity. Staff authority now comes
 * from a StaffGrant, and the only ways to obtain one are an invitation (src/server/staff/grants.ts) or an explicit
 * conversion (src/server/staff/promote.ts), both of which remove the dating account first.
 */

function configuredToken(): string | null {
  const token = getEnv().ADMIN_BOOTSTRAP_TOKEN;
  return token && token.length >= 32 ? token : null;
}

/** True only while the token is configured AND no administrator exists yet. */
export async function isBootstrapAvailable(db: DbLike): Promise<boolean> {
  if (!configuredToken()) return false;
  return (await countAdmins(db)) === 0;
}

export type BootstrapResult =
  /** The address the set-password link was sent to, so the page can say where to look. */
  | { ok: true; email: string }
  | { ok: false; code: "UNAVAILABLE" | "INVALID_TOKEN" | "RATE_LIMITED" | "NOT_ELIGIBLE"; message?: string };

export async function bootstrapFirstAdmin(actor: Actor, token: string, deps: { db?: Db; now?: Date; token?: string | null; email?: EmailProvider } = {}): Promise<BootstrapResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const expected = deps.token === undefined ? configuredToken() : deps.token;
  if (!expected) return { ok: false, code: "UNAVAILABLE" };
  const limit = await consumeRateLimit(db, `admin:bootstrap:${actor.userId}`, 5, 3_600_000, now);
  if (!limit.allowed) return { ok: false, code: "RATE_LIMITED" };
  const given = Buffer.from(String(token ?? ""));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, code: "INVALID_TOKEN" };

  if ((await countAdmins(db)) > 0) return { ok: false, code: "UNAVAILABLE" };
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, accountType: true, role: true, status: true, onboardingCompletedAt: true } });
  if (!user || user.status !== "ACTIVE" || user.accountType !== "MEMBER" || !user.onboardingCompletedAt) return { ok: false, code: "NOT_ELIGIBLE" };

  // A successful claim is a full conversion, not a role flip: the claimant's dating profile goes, an ACTIVE grant
  // is created and a set-password link is issued. `promoteAccountToStaff` re-checks "no administrator yet" under
  // the same advisory lock it takes, so two simultaneous claims cannot both succeed.
  try {
    const promotion = await promoteAccountToStaff(db, user.id, {
      role: "ADMIN",
      reason: "First administrator claimed with the bootstrap token",
      now,
      via: "bootstrap",
      actorId: user.id,
      requireNoExistingAdmin: true,
    });
    await writeAudit(db, {
      actorId: user.id,
      action: AUDIT_ACTIONS.adminBootstrapped,
      targetType: "User",
      targetId: user.id,
      data: { via: "bootstrap-token", before: { accountType: user.accountType, role: user.role }, after: { accountType: "STAFF", role: "ADMIN" } },
      now,
    });
    await sendStaffInviteEmail(promotion.email, promotion.token, promotion.expiresAt, { setup: true, provider: deps.email, now });
    return { ok: true, email: promotion.email };
  } catch (e) {
    if (e instanceof InvalidStateError) return { ok: false, code: "NOT_ELIGIBLE", message: e.message };
    throw e;
  }
}

/*
 * `grantRoleFromCli()` used to live here and set User.role directly. It is gone for the same reason
 * `changeUserRole()` is: a role on a dating account produces an operator with a profile and a place in discovery.
 * The replacement is scripts/convert-admin-to-staff.ts, which converts the account first and then grants it, and
 * scripts/grant-admin.ts now points at it.
 */

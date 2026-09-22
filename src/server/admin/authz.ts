/**
 * Admin authorization (docs/ARCHITECTURE.md §21). The only thing that makes someone an administrator is
 * `User.role` on their canonical account row, read from the database on every request through the session
 * lookup. Nothing here trusts a header, query parameter, cookie flag or client payload, and every admin mutation
 * calls `requireAdmin()` itself.
 *
 * Two things must both be true (docs/ARCHITECTURE.md §22.1): the account is STAFF — an operational account, never
 * a dating one — and it holds an ACTIVE StaffGrant carrying a staff role. The account type is read from the
 * session; the grant is read from the database on every request, so revocation takes effect immediately.
 *
 * Roles: ADMIN has every permission; MODERATOR is limited to the safety and verification surfaces. A signed-in
 * non-staff account asking for an admin page gets the same 404 as a page that does not exist (NotFound, never
 * Forbidden), so the portal never confirms that it is there.
 */
import { cache } from "react";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { findLiveStaffGrant } from "@/server/staff/live-grant";
import { getAuthState } from "@/server/auth/current-user";
import type { Actor } from "@/server/actor";

import { hasPermission, isAdminRole, type AdminRole, type Permission } from "./permissions";

export { hasPermission, isAdminRole, ROLE_PERMISSIONS, type AdminRole, type Permission } from "./permissions";

export interface AdminActor extends Actor {
  readonly role: AdminRole;
}

export class AdminAccessError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AdminAccessError";
  }
}

/**
 * Pure check used by the guards and by tests: the acting user must be an active STAFF account holding a staff
 * role. The account-type test is the important one — a dating MEMBER whose `role` column says ADMIN (a stale row,
 * a bad migration, a direct database edit) is refused here, so authority can never leak back into the member
 * domain. Onboarding is deliberately NOT required: staff never go through it (docs/ARCHITECTURE.md §22.1).
 */
export function adminActorFrom(user: { id: string; accountType?: string; role: string; status: string } | null | undefined): AdminActor | null {
  if (!user) return null;
  if (user.accountType !== "STAFF") return null;
  if (user.status !== "ACTIVE") return null;
  if (!isAdminRole(user.role)) return null;
  return { userId: user.id, role: user.role };
}

/**
 * Memoised per request. Null for anyone who is not a live staff account; never throws.
 *
 * Two independent conditions must hold: the session says STAFF, and the database still carries an ACTIVE
 * StaffGrant for the account. The grant is read on every request on purpose — revoking it has to close the door
 * immediately, not at the revoked person's next sign-in.
 */
export const getAdminActor = cache(async (): Promise<AdminActor | null> => {
  const state = await getAuthState();
  if (state.kind !== "staff") return null;
  const actor = adminActorFrom(state.user);
  if (!actor) return null;
  const grant = await findLiveStaffGrant(getDb(), actor.userId);
  if (!grant || !isAdminRole(grant.role)) return null;
  // The grant is the authority; the mirrored column is a convenience. If they ever disagree, believe the grant.
  return { userId: actor.userId, role: grant.role };
});

/** For admin pages/layouts: a non-admin (or an admin lacking the permission) gets a plain 404. */
export async function requireAdminPage(permission?: Permission): Promise<AdminActor> {
  const actor = await getAdminActor();
  if (!actor || (permission && !hasPermission(actor.role, permission))) notFound();
  return actor;
}

/** For server actions and route handlers: throws instead of redirecting. Callers map the error to a generic failure. */
export async function requireAdmin(permission?: Permission): Promise<AdminActor> {
  const actor = await getAdminActor();
  if (!actor || (permission && !hasPermission(actor.role, permission))) throw new AdminAccessError();
  return actor;
}

/**
 * The staff-domain names for the two guards above. `requireStaff` and `requireAdmin` are the same check: being
 * staff is what gets you into the portal, and the optional permission is what decides which part of it. Both names
 * exist because "staff" is the account domain and "admin" is the authority, and code reads better when it says
 * which one it means (docs/ARCHITECTURE.md §22.1).
 */
export const requireStaff = requireAdmin;
export const requireStaffPage = requireAdminPage;

/** Domain-layer guard for functions that receive an AdminActor from a caller (tests, scripts). */
export function assertPermission(actor: AdminActor, permission: Permission): void {
  if (!hasPermission(actor.role, permission)) throw new AdminAccessError();
}

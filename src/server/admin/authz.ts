/**
 * Admin authorization (docs/ARCHITECTURE.md §21). The only thing that makes someone an administrator is
 * `User.role` on their canonical account row, read from the database on every request through the session
 * lookup. Google confirms the person; it never confers a role. Nothing here trusts a header, query parameter,
 * cookie flag or client payload, and every admin mutation calls `requireAdmin()` itself.
 *
 * Roles: ADMIN has every permission; MODERATOR is limited to the safety and verification surfaces. A signed-in
 * non-admin asking for an admin page gets the same 404 as a page that does not exist (NotFound, never Forbidden).
 */
import { cache } from "react";
import { notFound } from "next/navigation";
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

/** Pure check used by the guards and by tests: the acting user must be a signed-in, fully onboarded admin. */
export function adminActorFrom(user: { id: string; role: string; status: string; onboardingCompletedAt: Date | null } | null | undefined): AdminActor | null {
  if (!user) return null;
  if (user.status !== "ACTIVE" || !user.onboardingCompletedAt) return null;
  if (!isAdminRole(user.role)) return null;
  return { userId: user.id, role: user.role };
}

/** Memoised per request. Null for anyone who is not an active admin; never throws. */
export const getAdminActor = cache(async (): Promise<AdminActor | null> => {
  const state = await getAuthState();
  if (state.kind !== "active") return null;
  return adminActorFrom(state.user);
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

/** Domain-layer guard for functions that receive an AdminActor from a caller (tests, scripts). */
export function assertPermission(actor: AdminActor, permission: Permission): void {
  if (!hasPermission(actor.role, permission)) throw new AdminAccessError();
}

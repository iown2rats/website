/**
 * Pure role → permission mapping for the admin area (docs/ARCHITECTURE.md §21.1). No server imports, so client
 * components may use it to tidy navigation; authorization itself is always re-checked on the server (authz.ts).
 */
export type AdminRole = "MODERATOR" | "ADMIN";

export type Permission =
  | "dashboard.view"
  | "users.view"
  | "users.moderate"
  | "users.role"
  | "reports.act"
  | "verification.act"
  | "photos.moderate"
  | "payments.review"
  | "plans.manage"
  | "payment-methods.manage"
  | "subscriptions.view"
  | "subscriptions.adjust"
  | "audit.view";

const ALL_PERMISSIONS: readonly Permission[] = [
  "dashboard.view",
  "users.view",
  "users.moderate",
  "users.role",
  "reports.act",
  "verification.act",
  "photos.moderate",
  "payments.review",
  "plans.manage",
  "payment-methods.manage",
  "subscriptions.view",
  "subscriptions.adjust",
  "audit.view",
];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  MODERATOR: ["dashboard.view", "users.view", "users.moderate", "reports.act", "verification.act", "photos.moderate"],
};

export function isAdminRole(role: string): role is AdminRole {
  return role === "ADMIN" || role === "MODERATOR";
}

/** Fails closed: a role this build does not know grants nothing, rather than throwing on the lookup. */
export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

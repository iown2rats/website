/**
 * Audit trail for privileged actions (docs/ARCHITECTURE.md §21.6). One writer, one vocabulary. Payloads carry safe
 * before/after state only: keys that look like secrets are dropped before the row is written, and no admin surface
 * can edit or delete rows.
 */
import type { DbLike } from "@/lib/db";

export const AUDIT_ACTIONS = {
  adminRoleChanged: "admin.role.changed",
  adminBootstrapped: "admin.bootstrapped",
  userSuspended: "user.suspended",
  userUnsuspended: "user.unsuspended",
  userBanned: "user.banned",
  reportDecided: "report.decided",
  verificationDecided: "verification.decided",
  paymentApproved: "payment.approved",
  paymentRejected: "payment.rejected",
  receiptReprocessed: "receipt.reprocessed",
  subscriptionAdjusted: "subscription.adjusted",
  paymentMethodCreated: "payment_method.created",
  paymentMethodUpdated: "payment_method.updated",
  planCreated: "plan.created",
  planUpdated: "plan.updated",
  // Existing (user-initiated) actions written elsewhere, listed so the admin log can label them.
  accountDeleted: "account.deleted",
  accountRecreated: "account.recreated",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

const SECRET_KEY = /secret|token|password|hash|salt|cookie|nonce|verifier|providerRef|providerSubject|apikey|authorization/i;

/** Drops secret-looking keys (recursively) so a careless caller can never persist one. */
export function sanitizeAuditData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditData);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = sanitizeAuditData(v);
    }
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
  now?: Date;
}

export async function writeAudit(db: DbLike, entry: AuditEntry): Promise<void> {
  const data = entry.data ? (sanitizeAuditData(entry.data) as Record<string, unknown>) : undefined;
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      data: data === undefined ? undefined : JSON.parse(JSON.stringify(data)),
      createdAt: entry.now ?? new Date(),
    },
  });
}

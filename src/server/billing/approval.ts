/**
 * Admin review of manual payments (docs/ARCHITECTURE.md §12.12). This is the ONLY code path that creates a
 * Subscription from an order. Approval runs in one transaction: lock the order row, lock the customer, compute the
 * period from the order's snapshot (never from the client), insert the Subscription with the order's unique id,
 * mark the order APPROVED, notify the customer, write the audit row. A second approval (double tap, refresh, another
 * admin) either waits on the row lock and then sees APPROVED, or hits the unique orderId constraint; both are
 * reported as the same idempotent success.
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordPlusEvent } from "@/server/analytics/plus-funnel";
import { getDb, type Db, type DbLike, type Tx } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import { noMarkup } from "@/lib/validation/onboarding";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { assertPermission, type AdminActor } from "@/server/admin/authz";
import { GRANTING_SUBSCRIPTION_STATUSES } from "@/server/entitlements";
import { buildOrderDto, orderInclude, expireStaleOrders, type OrderDto } from "./orders";
import { approvalNeedsReason, toAdminVerificationDto, type AdminReceiptVerificationDto } from "./receipt-dto";
import { assertTransition } from "./state";

export const MANUAL_PROVIDER = "manual_bank_transfer";

export interface AdminOrderDto extends OrderDto {
  user: { userId: string; handle: string | null; displayName: string | null; status: string };
  decidedBy: { userId: string; displayName: string | null } | null;
  planCode: string | null;
  /** Latest OCR pass over the attached receipt, in full (§12.14). */
  verification: AdminReceiptVerificationDto | null;
  /** Every OCR pass, newest first. */
  verificationHistory: AdminReceiptVerificationDto[];
  /** True when the latest reading is a material mismatch or a duplicate: approving then needs a recorded reason. */
  approvalNeedsReason: boolean;
}

const adminInclude = {
  ...orderInclude,
  verifications: { orderBy: { createdAt: "desc" as const } },
  user: { select: { id: true, status: true, profile: { select: { handle: true, displayName: true } } } },
  decidedBy: { select: { id: true, profile: { select: { displayName: true } } } },
  plan: { select: { code: true } },
} as const;
type AdminRow = Prisma.SubscriptionOrderGetPayload<{ include: typeof adminInclude }>;

async function toAdminDto(row: AdminRow, options: { storage?: StorageProvider; withReceipt?: boolean } = {}): Promise<AdminOrderDto> {
  const base = await buildOrderDto(row, options);
  return {
    ...base,
    user: { userId: row.user.id, handle: row.user.profile?.handle ?? null, displayName: row.user.profile?.displayName ?? null, status: row.user.status },
    decidedBy: row.decidedBy ? { userId: row.decidedBy.id, displayName: row.decidedBy.profile?.displayName ?? null } : null,
    planCode: row.plan?.code ?? null,
    verification: row.verifications[0] ? toAdminVerificationDto(row.verifications[0]) : null,
    verificationHistory: row.verifications.map(toAdminVerificationDto),
    approvalNeedsReason: approvalNeedsReason(row.verifications[0] ?? null),
  };
}

export const overrideReasonSchema = noMarkup(300, "Reason").pipe(z.string().min(3, "Explain why you are approving despite the receipt check"));

export type PaymentQueueFilter = "pending" | "approved" | "rejected" | "all";

export async function listOrdersForAdmin(admin: AdminActor, filter: PaymentQueueFilter, deps: { db?: Db; now?: Date; page?: number; pageSize?: number } = {}): Promise<{ items: AdminOrderDto[]; total: number; page: number; pageSize: number }> {
  assertPermission(admin, "payments.review");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const page = Math.max(1, deps.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, deps.pageSize ?? 25));
  await expireStaleOrders(db, now);
  const where: Prisma.SubscriptionOrderWhereInput = filter === "pending" ? { status: "SUBMITTED" } : filter === "approved" ? { status: "APPROVED" } : filter === "rejected" ? { status: "REJECTED" } : {};
  const [rows, total] = await Promise.all([
    db.subscriptionOrder.findMany({ where, include: adminInclude, orderBy: filter === "pending" ? [{ submittedAt: "asc" }] : [{ createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    db.subscriptionOrder.count({ where }),
  ]);
  return { items: await Promise.all(rows.map((r) => toAdminDto(r))), total, page, pageSize };
}

export async function getOrderForAdmin(admin: AdminActor, orderId: string, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<AdminOrderDto> {
  assertPermission(admin, "payments.review");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  await expireStaleOrders(db, now);
  const row = await db.subscriptionOrder.findUnique({ where: { id: orderId }, include: adminInclude });
  if (!row) throw new NotFoundError("Order");
  return toAdminDto(row, { storage: deps.storage ?? getStorageProvider(), withReceipt: true });
}

async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  await tx.$executeRaw`SELECT id FROM "SubscriptionOrder" WHERE id = ${orderId} FOR UPDATE`;
}

async function lockCustomerSubscriptions(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"sub:" + userId}))`;
}

/**
 * Period rule (docs/ARCHITECTURE.md §12.12): a first purchase starts at approval time; a renewal while Plus is still
 * active starts when the current paid period ends, so early renewal never loses paid time.
 */
export async function computePeriod(db: DbLike, userId: string, durationDays: number, now: Date): Promise<{ start: Date; end: Date }> {
  const latest = await db.subscription.findFirst({ where: { userId, currentPeriodEnd: { gt: now }, status: { in: [...GRANTING_SUBSCRIPTION_STATUSES] } }, orderBy: { currentPeriodEnd: "desc" }, select: { currentPeriodEnd: true } });
  const start = latest && latest.currentPeriodEnd > now ? latest.currentPeriodEnd : now;
  return { start, end: new Date(start.getTime() + durationDays * 24 * 3_600_000) };
}

export interface ApprovalResult {
  order: AdminOrderDto;
  /** True when the order was already approved before this call (nothing changed). */
  alreadyApproved: boolean;
}

/**
 * `reason` is required only when the latest receipt check is a material mismatch or a duplicate (§12.14): the admin
 * may still approve a transfer they have seen in the bank statement, but must say why, and the audit row keeps both
 * the OCR outcome and the explanation.
 */
export async function approveOrder(admin: AdminActor, orderId: string, deps: { db?: Db; now?: Date; reason?: string } = {}): Promise<ApprovalResult> {
  assertPermission(admin, "payments.review");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  try {
    const result = await db.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const order = await tx.subscriptionOrder.findUnique({ where: { id: orderId }, include: adminInclude });
      if (!order) throw new NotFoundError("Order");
      if (order.status === "APPROVED") return { order: await toAdminDto(order), alreadyApproved: true };
      if (order.userId === admin.userId) throw new InvalidStateError("You can't review your own payment");
      assertTransition(order.status, "APPROVED");
      if (order.user.status === "DELETED") throw new InvalidStateError("This account has been deleted; nothing can be activated");
      const latest = order.verifications[0] ?? null;
      let overrideReason: string | null = null;
      if (approvalNeedsReason(latest)) {
        const parsed = overrideReasonSchema.safeParse(deps.reason ?? "");
        if (!parsed.success) throw new ValidationError("The receipt check found a mismatch. Explain why you are approving anyway; this is recorded in the audit log.");
        overrideReason = parsed.data;
      }

      await lockCustomerSubscriptions(tx, order.userId);
      const period = await computePeriod(tx, order.userId, order.durationDays, now);
      const subscription = await tx.subscription.create({
        data: {
          userId: order.userId,
          planId: order.planId,
          status: "ACTIVE",
          provider: MANUAL_PROVIDER,
          providerSubscriptionRef: `order:${order.id}`,
          orderId: order.id,
          startedAt: period.start,
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
        },
        select: { id: true },
      });
      const updated = await tx.subscriptionOrder.update({ where: { id: order.id }, data: { status: "APPROVED", decidedById: admin.userId, decidedAt: now }, include: adminInclude });
      await tx.notification.create({ data: { userId: order.userId, type: "PAYMENT_APPROVED", data: { orderId: order.id, reference: order.reference, planName: order.planName, periodEnd: period.end.toISOString() }, createdAt: now } });
      await writeAudit(tx, {
        actorId: admin.userId,
        action: AUDIT_ACTIONS.paymentApproved,
        targetType: "SubscriptionOrder",
        targetId: order.id,
        data: { reference: order.reference, userId: order.userId, amountMinor: order.amountMinor, currency: order.currency, durationDays: order.durationDays, subscriptionId: subscription.id, periodStart: period.start, periodEnd: period.end, receiptOutcome: latest?.outcome ?? null, overrideReason, before: { status: order.status }, after: { status: "APPROVED" } },
        now,
      });
      return { order: await toAdminDto(updated), alreadyApproved: false };
    });
    // Funnel step (§12.19), only once the approval has COMMITTED, keyed on the order; never throws.
    if (!result.alreadyApproved) {
      await recordPlusEvent({ event: "plus_payment_approved", userId: result.order.user.userId, orderId: result.order.id, eventKey: `approved:${result.order.id}`, now }, { db });
    }
    return result;
  } catch (e) {
    // A racing approval committed first and took the unique orderId: report the same idempotent success.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await db.subscriptionOrder.findUnique({ where: { id: orderId }, include: adminInclude });
      if (row?.status === "APPROVED") return { order: await toAdminDto(row), alreadyApproved: true };
    }
    throw e;
  }
}

export const rejectionReasonSchema = noMarkup(300, "Reason").pipe(z.string().min(3, "Give the customer a short reason"));

export async function rejectOrder(admin: AdminActor, orderId: string, input: { reason: string }, deps: { db?: Db; now?: Date } = {}): Promise<AdminOrderDto> {
  assertPermission(admin, "payments.review");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = rejectionReasonSchema.safeParse(input?.reason ?? "");
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Give the customer a short reason");
  const reason = parsed.data;
  const row = await db.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.subscriptionOrder.findUnique({ where: { id: orderId }, include: adminInclude });
    if (!order) throw new NotFoundError("Order");
    if (order.status === "REJECTED") return order;
    if (order.userId === admin.userId) throw new InvalidStateError("You can't review your own payment");
    assertTransition(order.status, "REJECTED");
    const updated = await tx.subscriptionOrder.update({ where: { id: order.id }, data: { status: "REJECTED", decidedById: admin.userId, decidedAt: now, rejectionReason: reason }, include: adminInclude });
    await tx.notification.create({ data: { userId: order.userId, type: "PAYMENT_REJECTED", data: { orderId: order.id, reference: order.reference, planName: order.planName, reason }, createdAt: now } });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.paymentRejected, targetType: "SubscriptionOrder", targetId: order.id, data: { reference: order.reference, userId: order.userId, reason, before: { status: order.status }, after: { status: "REJECTED" } }, now });
    return updated;
  });
  return toAdminDto(row);
}

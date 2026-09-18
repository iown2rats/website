/**
 * Admin view of subscriptions and the one privileged adjustment (docs/ARCHITECTURE.md §21.4). Dates are never
 * changed silently: an adjustment needs a reason and writes before/after to the audit log.
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { noMarkup } from "@/lib/validation/onboarding";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { assertPermission, type AdminActor } from "@/server/admin/authz";
import { GRANTING_SUBSCRIPTION_STATUSES } from "@/server/entitlements";
import { EXPIRY } from "./expiry";

export type SubscriptionFilter = "active" | "expiring" | "expired" | "all";

export interface AdminSubscriptionDto {
  id: string;
  user: { userId: string; handle: string | null; displayName: string | null };
  planCode: string;
  planName: string;
  status: string;
  provider: string;
  orderReference: string | null;
  startedAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** Derived at read time from the period, not from `status`. */
  granting: boolean;
}

const include = { user: { select: { id: true, profile: { select: { handle: true, displayName: true } } } }, plan: { select: { code: true, name: true } }, order: { select: { reference: true } } } as const;
type Row = Prisma.SubscriptionGetPayload<{ include: typeof include }>;

function toDto(s: Row, now: Date): AdminSubscriptionDto {
  return {
    id: s.id,
    user: { userId: s.user.id, handle: s.user.profile?.handle ?? null, displayName: s.user.profile?.displayName ?? null },
    planCode: s.plan.code,
    planName: s.plan.name,
    status: s.status,
    provider: s.provider,
    orderReference: s.order?.reference ?? null,
    startedAt: s.startedAt.toISOString(),
    currentPeriodStart: s.currentPeriodStart.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    granting: s.currentPeriodEnd > now && (GRANTING_SUBSCRIPTION_STATUSES as readonly string[]).includes(s.status),
  };
}

export async function listSubscriptionsForAdmin(admin: AdminActor, input: { filter: SubscriptionFilter; q?: string; page?: number; pageSize?: number }, deps: { db?: Db; now?: Date } = {}): Promise<{ items: AdminSubscriptionDto[]; total: number; page: number; pageSize: number }> {
  assertPermission(admin, "subscriptions.view");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const granting: Prisma.SubscriptionWhereInput = { status: { in: [...GRANTING_SUBSCRIPTION_STATUSES] } };
  const byFilter: Prisma.SubscriptionWhereInput =
    input.filter === "active"
      ? { ...granting, currentPeriodEnd: { gt: now } }
      : input.filter === "expiring"
        ? { ...granting, currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + EXPIRY.expiringSoonWindowMs) } }
        : input.filter === "expired"
          ? { OR: [{ status: "EXPIRED" }, { currentPeriodEnd: { lte: now } }] }
          : {};
  const q = input.q?.trim();
  const search: Prisma.SubscriptionWhereInput = q ? { OR: [{ user: { id: q } }, { user: { profile: { handle: { equals: q, mode: "insensitive" } } } }, { user: { profile: { displayName: { contains: q, mode: "insensitive" } } } }, { order: { reference: { equals: q.toUpperCase() } } }] } : {};
  const where: Prisma.SubscriptionWhereInput = { AND: [byFilter, search] };
  const [rows, total] = await Promise.all([
    db.subscription.findMany({ where, include, orderBy: { currentPeriodEnd: input.filter === "expiring" ? "asc" : "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.subscription.count({ where }),
  ]);
  return { items: rows.map((r) => toDto(r, now)), total, page, pageSize };
}

export const adjustmentSchema = z.object({
  currentPeriodEnd: z.coerce.date(),
  reason: noMarkup(300, "Reason").pipe(z.string().min(3, "Say why the period is being changed")),
});

/** Privileged: moves a subscription's period end. Reason required; before/after audited. Never touches other rows. */
export async function adjustSubscriptionPeriod(admin: AdminActor, subscriptionId: string, input: unknown, deps: { db?: Db; now?: Date } = {}): Promise<AdminSubscriptionDto> {
  assertPermission(admin, "subscriptions.adjust");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the adjustment");
  const { currentPeriodEnd, reason } = parsed.data;
  const before = await db.subscription.findUnique({ where: { id: subscriptionId }, include });
  if (!before) throw new NotFoundError("Subscription");
  if (currentPeriodEnd.getTime() <= before.currentPeriodStart.getTime()) throw new ValidationError("The period must end after it starts");
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.subscription.update({ where: { id: subscriptionId }, data: { currentPeriodEnd, status: currentPeriodEnd > now && before.status === "EXPIRED" ? "ACTIVE" : before.status }, include });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.subscriptionAdjusted, targetType: "Subscription", targetId: subscriptionId, data: { userId: before.userId, reason, before: { currentPeriodEnd: before.currentPeriodEnd, status: before.status }, after: { currentPeriodEnd: updated.currentPeriodEnd, status: updated.status } }, now });
    return updated;
  });
  return toDto(row, now);
}

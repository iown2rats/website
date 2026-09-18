/**
 * Subscription orders — the customer side of buying Plus by bank transfer (docs/ARCHITECTURE.md §12.11–§12.12).
 *
 *  - An order snapshots the plan's commercial terms and the payment method's details at creation. Nothing later
 *    rewrites them.
 *  - One open order per customer (AWAITING_PAYMENT or SUBMITTED). Asking again for the same plan returns it;
 *    asking for a different plan replaces an unpaid order; a submitted order is never replaced.
 *  - Paying is two steps (§12.14): attachReceipt stores the image and runs the OCR check while the order stays
 *    AWAITING_PAYMENT, then submitOrder moves it to SUBMITTED. `submitReceipt` does both for callers that want one step.
 *  - Nothing here grants Plus. Only src/server/billing/approval.ts (admin) creates a Subscription.
 */
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db, type DbLike, type Tx } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import type { OcrEngine } from "@/server/ocr/engine";
import { getCheckoutPaymentMethod } from "./payment-methods";
import { isPlanForSale } from "./plans";
import { toCustomerCheckDto, type ReceiptCheckDto } from "./receipt-dto";
import { attachReceipt, submitOrder, type ReceiptUpload } from "./receipts";
import { generateReference } from "./reference";
import { assertTransition, OPEN_ORDER_STATUSES, type OrderStatus } from "./state";

export type { ReceiptUpload } from "./receipts";

export const ORDER_RULES = {
  /** Unpaid orders lapse after this long. */
  awaitingPaymentTtlMs: 7 * 24 * 3_600_000,
  /** Decided orders stay "current" on the Membership screen for this long. */
  decidedVisibleMs: 30 * 24 * 3_600_000,
  receiptMaxBytes: 8 * 1024 * 1024,
  receiptUrlTtlSeconds: 300,
  receiptUploadsPerHour: 10,
  referenceAttempts: 5,
} as const;

export interface OrderDto {
  id: string;
  reference: string;
  status: OrderStatus;
  planName: string;
  amountMinor: number;
  amountLabel: string;
  currency: string;
  durationDays: number;
  method: { label: string; bankName: string; accountHolder: string; accountNumber: string; instructions: string | null };
  createdAt: string;
  expiresAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  hasReceipt: boolean;
  /** When the current receipt was attached (the latest OCR pass), or null. */
  receiptAttachedAt: string | null;
  /** The customer-safe summary of the latest OCR check on the attached receipt, or null (§12.14). */
  check: ReceiptCheckDto | null;
  /** Short-lived signed URL, only when the caller asked for it. */
  receiptUrl: string | null;
  /** When the activated subscription period ends (APPROVED only). */
  periodEnd: string | null;
}

export const orderInclude = { subscription: { select: { currentPeriodEnd: true } }, verifications: { orderBy: { createdAt: "desc" as const }, take: 1 } } as const;
type OrderRow = Prisma.SubscriptionOrderGetPayload<{ include: typeof orderInclude }>;

export async function buildOrderDto(row: OrderRow, options: { storage?: StorageProvider; withReceipt?: boolean } = {}): Promise<OrderDto> {
  const receiptUrl = options.withReceipt && row.receiptKey && options.storage ? await options.storage.getReadUrl(row.receiptKey, ORDER_RULES.receiptUrlTtlSeconds) : null;
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    planName: row.planName,
    amountMinor: row.amountMinor,
    amountLabel: formatMoney(row.amountMinor, row.currency),
    currency: row.currency,
    durationDays: row.durationDays,
    method: { label: row.methodLabel, bankName: row.bankName, accountHolder: row.accountHolder, accountNumber: row.accountNumber, instructions: row.instructions },
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    hasReceipt: Boolean(row.receiptKey),
    receiptAttachedAt: row.receiptKey ? (row.verifications[0]?.createdAt.toISOString() ?? null) : null,
    check: row.receiptKey && row.verifications[0] ? toCustomerCheckDto(row.verifications[0]) : null,
    receiptUrl,
    periodEnd: row.subscription?.currentPeriodEnd.toISOString() ?? null,
  };
}

/** Lapses unpaid orders past their deadline. Cheap; called by every read path so no scheduler is needed. */
export async function expireStaleOrders(db: DbLike, now: Date, userId?: string): Promise<number> {
  const r = await db.subscriptionOrder.updateMany({ where: { status: "AWAITING_PAYMENT", expiresAt: { lte: now }, ...(userId ? { userId } : {}) }, data: { status: "EXPIRED" } });
  return r.count;
}

async function lockCustomer(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"order:" + userId}))`;
}

async function assertCanBuy(db: DbLike, userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true, onboardingCompletedAt: true } });
  if (!user || user.status === "DELETED") throw new InvalidStateError("This account can't buy Plus");
  if (user.status !== "ACTIVE" || !user.onboardingCompletedAt) throw new InvalidStateError("Finish setting up your account before getting Plus");
}

/**
 * Starts (or returns) the customer's order for a plan. The plan and payment method are re-read on the server; the
 * client's only input is which plan it wants.
 */
export async function createOrder(actor: Actor, input: { planId: string }, deps: { db?: Db; now?: Date } = {}): Promise<OrderDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const planId = typeof input?.planId === "string" ? input.planId : "";
  if (!planId || planId.length > 64) throw new ValidationError("Choose a plan");

  await assertCanBuy(db, actor.userId);
  const plan = await db.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !isPlanForSale(plan)) throw new ValidationError("That plan isn't available right now");
  const method = await getCheckoutPaymentMethod(db);
  if (!method) throw new InvalidStateError("Payments aren't available right now");

  for (let attempt = 0; ; attempt += 1) {
    const reference = generateReference();
    try {
      const row = await db.$transaction(async (tx) => {
        await lockCustomer(tx, actor.userId);
        await expireStaleOrders(tx, now, actor.userId);
        const open = await tx.subscriptionOrder.findMany({ where: { userId: actor.userId, status: { in: [...OPEN_ORDER_STATUSES] } }, include: orderInclude, orderBy: { createdAt: "desc" } });
        const submitted = open.find((o) => o.status === "SUBMITTED");
        if (submitted) return submitted;
        const awaiting = open.find((o) => o.status === "AWAITING_PAYMENT");
        if (awaiting && awaiting.planId === plan.id) return awaiting;
        if (awaiting) {
          assertTransition(awaiting.status, "CANCELLED");
          await tx.subscriptionOrder.update({ where: { id: awaiting.id }, data: { status: "CANCELLED" } });
        }
        return tx.subscriptionOrder.create({
          data: {
            reference,
            userId: actor.userId,
            planId: plan.id,
            paymentMethodId: method.id,
            status: "AWAITING_PAYMENT",
            planName: plan.name,
            amountMinor: plan.priceMinor,
            currency: plan.currency,
            durationDays: plan.intervalDays,
            methodLabel: method.label,
            bankName: method.bankName,
            accountHolder: method.accountHolder,
            accountNumber: method.accountNumber,
            instructions: method.instructions,
            expiresAt: new Date(now.getTime() + ORDER_RULES.awaitingPaymentTtlMs),
            createdAt: now,
          },
          include: orderInclude,
        });
      });
      return buildOrderDto(row);
    } catch (e) {
      const collision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!collision || attempt + 1 >= ORDER_RULES.referenceAttempts) throw e;
    }
  }
}

async function ownedOrder(db: DbLike, actor: Actor, orderId: string): Promise<OrderRow> {
  const row = await db.subscriptionOrder.findFirst({ where: { id: orderId, userId: actor.userId }, include: orderInclude });
  if (!row) throw new NotFoundError("Order");
  return row;
}

export async function getOrderForActor(actor: Actor, orderId: string, deps: { db?: Db; storage?: StorageProvider; now?: Date; withReceipt?: boolean } = {}): Promise<OrderDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  await expireStaleOrders(db, now, actor.userId);
  const row = await ownedOrder(db, actor, orderId);
  return buildOrderDto(row, { storage: deps.withReceipt ? deps.storage ?? getStorageProvider() : undefined, withReceipt: deps.withReceipt });
}

export async function listOrdersForActor(actor: Actor, deps: { db?: Db; now?: Date; take?: number } = {}): Promise<OrderDto[]> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  await expireStaleOrders(db, now, actor.userId);
  const rows = await db.subscriptionOrder.findMany({ where: { userId: actor.userId }, include: orderInclude, orderBy: { createdAt: "desc" }, take: deps.take ?? 10 });
  return Promise.all(rows.map((r) => buildOrderDto(r)));
}

/** The order the Membership screen should talk about: an open one, else one decided in the last 30 days. */
export async function getCurrentOrderForActor(actor: Actor, deps: { db?: Db; now?: Date } = {}): Promise<OrderDto | null> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  await expireStaleOrders(db, now, actor.userId);
  const row = await db.subscriptionOrder.findFirst({
    where: { userId: actor.userId, OR: [{ status: { in: [...OPEN_ORDER_STATUSES] } }, { status: { in: ["APPROVED", "REJECTED"] }, decidedAt: { gte: new Date(now.getTime() - ORDER_RULES.decidedVisibleMs) } }] },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  return row ? buildOrderDto(row) : null;
}

/** The customer gives up on an unpaid order. Submitted orders wait for the admin's decision instead. */
export async function cancelOrder(actor: Actor, orderId: string, deps: { db?: Db; now?: Date } = {}): Promise<OrderDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const row = await db.$transaction(async (tx) => {
    await lockCustomer(tx, actor.userId);
    await expireStaleOrders(tx, now, actor.userId);
    const current = await ownedOrder(tx, actor, orderId);
    if (current.status === "CANCELLED") return current;
    assertTransition(current.status, "CANCELLED");
    return tx.subscriptionOrder.update({ where: { id: current.id }, data: { status: "CANCELLED" }, include: orderInclude });
  });
  return buildOrderDto(row);
}

/**
 * One-step "attach and submit": stores the receipt (running the OCR check) and moves the order to SUBMITTED. The order
 * screen uses the two steps separately so the customer sees the check before submitting; this exists for callers that
 * want the whole thing at once. Submitting twice returns the already-submitted order.
 */
export async function submitReceipt(actor: Actor, orderId: string, file: ReceiptUpload, deps: { db?: Db; storage?: StorageProvider; now?: Date; engine?: OcrEngine } = {}): Promise<OrderDto> {
  const db = deps.db ?? getDb();
  const current = await ownedOrder(db, actor, orderId);
  if (current.status === "SUBMITTED") return buildOrderDto(current);
  await attachReceipt(actor, orderId, file, deps);
  const { id } = await submitOrder(actor, orderId, { db, now: deps.now });
  return buildOrderDto(await ownedOrder(db, actor, id));
}

/** attachReceipt, then the fresh order DTO the screen needs (§12.14). */
export async function attachReceiptToOrder(actor: Actor, orderId: string, file: ReceiptUpload, deps: { db?: Db; storage?: StorageProvider; now?: Date; engine?: OcrEngine } = {}): Promise<{ order: OrderDto; check: ReceiptCheckDto }> {
  const db = deps.db ?? getDb();
  const { id, check } = await attachReceipt(actor, orderId, file, deps);
  return { order: await buildOrderDto(await ownedOrder(db, actor, id)), check };
}

/** submitOrder, then the fresh order DTO. */
export async function submitOrderForActor(actor: Actor, orderId: string, deps: { db?: Db; now?: Date } = {}): Promise<OrderDto> {
  const db = deps.db ?? getDb();
  const { id } = await submitOrder(actor, orderId, { db, now: deps.now });
  return buildOrderDto(await ownedOrder(db, actor, id));
}

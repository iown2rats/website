/**
 * Receipts and the OCR-assisted check (docs/ARCHITECTURE.md §12.14).
 *
 *  attachReceipt  — customer: validate → re-encode → store privately → OCR → parse → duplicate lookup → verify → persist
 *                   a ReceiptVerification row. The order stays AWAITING_PAYMENT. Replacing the slip repeats all of it.
 *  submitOrder    — customer: AWAITING_PAYMENT → SUBMITTED, only with a receipt attached. Idempotent.
 *  reprocessReceipt — admin: re-run OCR on the stored image after a parser change. Audited, rate-limited, never moves
 *                   the order, never grants anything.
 *
 * The verification row is written by the server from the stored image. The browser posts a file and nothing else, so
 * "OCR read this" is never a sentence a customer can write for themselves. Raw OCR text is not stored or logged.
 */
import { createHash } from "node:crypto";
import { Prisma, type ReceiptVerification } from "@/generated/prisma/client";
import { getDb, type Db, type DbLike, type Tx } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { assertPermission, type AdminActor } from "@/server/admin/authz";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { processImage } from "@/server/media/process-image";
import { sniffUnsupported, UNSUPPORTED_MESSAGES } from "@/server/media/sniff";
import type { OcrEngine } from "@/server/ocr/engine";
import { readReceipt } from "@/server/ocr/read";
import type { DuplicateSignal, NormalizedTransaction, OrderExpectation } from "@/server/ocr/types";
import { verifyAgainstOrder } from "@/server/ocr/verify";
import { toAdminVerificationDto, toCustomerCheckDto, type AdminReceiptVerificationDto, type ReceiptCheckDto } from "./receipt-dto";
import { assertTransition } from "./state";

export const RECEIPT_RULES = {
  maxBytes: 8 * 1024 * 1024,
  uploadsPerHour: 10,
  /** Admin OCR re-runs per admin per hour. */
  rerunsPerHour: 10,
  urlTtlSeconds: 300,
} as const;

export interface ReceiptUpload {
  bytes: Uint8Array;
  size: number;
}

export interface AttachResult {
  /** The order id (still AWAITING_PAYMENT). orders.ts builds the DTO, which avoids an import cycle here. */
  id: string;
  check: ReceiptCheckDto;
}

type OrderRow = Prisma.SubscriptionOrderGetPayload<{ include: { verifications: { orderBy: { createdAt: "desc" }; take: 1 } } }>;

async function lockCustomer(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"order:" + userId}))`;
}

async function ownedOrder(db: DbLike, actor: Actor, orderId: string): Promise<OrderRow> {
  const row = await db.subscriptionOrder.findFirst({ where: { id: orderId, userId: actor.userId }, include: { verifications: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!row) throw new NotFoundError("Order");
  return row;
}

export function expectationFrom(order: { reference: string; amountMinor: number; currency: string; accountNumber: string; accountHolder: string; bankName: string; createdAt: Date; expiresAt: Date }): OrderExpectation {
  return { reference: order.reference, amountMinor: order.amountMinor, currency: order.currency, accountNumber: order.accountNumber, accountHolder: order.accountHolder, bankName: order.bankName, createdAt: order.createdAt, expiresAt: order.expiresAt };
}

export function hashTransactionId(normalizedId: string): string {
  return createHash("sha256").update(normalizedId).digest("hex");
}

/**
 * Has this bank transaction number been seen on another order? Runs inside the caller's transaction under an advisory
 * lock on the hash, so two receipts carrying the same number cannot both be written as "not seen before".
 */
export async function findDuplicate(tx: DbLike, hash: string, thisOrderId: string, thisUserId: string): Promise<DuplicateSignal> {
  const others = await tx.receiptVerification.findMany({
    where: { transactionIdHash: hash, orderId: { not: thisOrderId } },
    orderBy: { createdAt: "asc" },
    select: { orderId: true, order: { select: { reference: true, status: true, userId: true } } },
  });
  const seen = new Map<string, (typeof others)[number]>();
  for (const o of others) if (!seen.has(o.orderId)) seen.set(o.orderId, o);
  if (seen.size === 0) return { kind: "NONE" };
  const first = [...seen.values()][0]!;
  const sameCustomer = first.order.userId === thisUserId;
  return {
    kind: "FOUND",
    note: `Also read on order ${first.order.reference} (${first.order.status.toLowerCase().replace("_", " ")}), ${sameCustomer ? "same customer" : "a different customer"}${seen.size > 1 ? ` and ${seen.size - 1} more` : ""}. Possible duplicate transfer.`,
    meta: { orderId: first.orderId, reference: first.order.reference, status: first.order.status, sameCustomer, others: String(seen.size) },
  };
}

/**
 * OCR → verify → persist, as one verification row. Duplicate detection and the insert share a transaction and an
 * advisory lock keyed on the transaction hash.
 */
export async function runVerification(db: Db, order: { id: string; userId: string; reference: string; amountMinor: number; currency: string; accountNumber: string; accountHolder: string; bankName: string; createdAt: Date; expiresAt: Date }, image: Uint8Array, deps: { engine?: OcrEngine; now?: Date; triggeredById?: string | null } = {}): Promise<ReceiptVerification> {
  const now = deps.now ?? new Date();
  const tx: NormalizedTransaction = await readReceipt(image, { engine: deps.engine });
  const hash = tx.transactionId ? hashTransactionId(tx.transactionId) : null;
  return db.$transaction(async (t) => {
    if (hash) await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"txn:" + hash}))`;
    const duplicate: DuplicateSignal = hash ? await findDuplicate(t, hash, order.id, order.userId) : { kind: "NOT_APPLICABLE" };
    const result = verifyAgainstOrder(tx, expectationFrom(order), duplicate, now);
    const attempt = (await t.receiptVerification.count({ where: { orderId: order.id } })) + 1;
    console.info(`[ocr] verified order=${order.id} attempt=${attempt} outcome=${result.outcome} bank=${tx.bank ?? "none"} duplicate=${duplicate.kind}`);
    return t.receiptVerification.create({
      data: {
        orderId: order.id,
        attempt,
        parserVersion: tx.parserVersion,
        engine: tx.engine,
        outcome: result.outcome,
        detectedBank: tx.bank,
        transactionStatus: tx.status,
        amountMinor: tx.amountMinor,
        currency: tx.currency,
        transactionId: tx.transactionId,
        transactionIdHash: hash,
        transactionAt: tx.transactionAt,
        transactionDateRaw: tx.transactionDateRaw,
        recipientAccount: tx.recipientAccount,
        recipientName: tx.recipientName,
        senderName: tx.senderName,
        remarks: tx.remarks,
        checks: result.checks as unknown as Prisma.InputJsonValue,
        ocrConfidence: tx.ocrConfidence,
        durationMs: tx.durationMs,
        triggeredById: deps.triggeredById ?? null,
        createdAt: now,
      },
    });
  });
}

/**
 * "I've made the transfer" → the receipt image. Validated (size, real format, PDF/HEIC named explicitly), re-encoded
 * with metadata dropped, stored under a server-chosen key, then checked by OCR. The order stays AWAITING_PAYMENT until
 * the customer submits. Replacing the slip stores a new key and deletes the previous one.
 */
export async function attachReceipt(actor: Actor, orderId: string, file: ReceiptUpload, deps: { db?: Db; storage?: StorageProvider; now?: Date; engine?: OcrEngine } = {}): Promise<AttachResult> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  if (file.size > RECEIPT_RULES.maxBytes || file.bytes.byteLength > RECEIPT_RULES.maxBytes) throw new ValidationError("That receipt is too large. Choose an image under 8 MB.");
  if (file.bytes.byteLength === 0) throw new ValidationError("That file is empty.");
  const unsupported = sniffUnsupported(file.bytes);
  if (unsupported) throw new ValidationError(UNSUPPORTED_MESSAGES[unsupported]);

  const current = await ownedOrder(db, actor, orderId);
  if (current.status === "SUBMITTED") throw new InvalidStateError("This receipt has already been submitted for review.");
  if (current.status === "AWAITING_PAYMENT" && current.expiresAt.getTime() <= now.getTime()) {
    await db.subscriptionOrder.updateMany({ where: { id: current.id, status: "AWAITING_PAYMENT" }, data: { status: "EXPIRED" } });
    throw new InvalidStateError("This order has expired. Start a new one from Membership.");
  }
  if (current.status !== "AWAITING_PAYMENT") throw new InvalidStateError("This order can't take a receipt any more.");

  const limit = await consumeRateLimit(db, `billing:receipt:${actor.userId}`, RECEIPT_RULES.uploadsPerHour, 3_600_000, now);
  if (!limit.allowed) throw new ValidationError("Too many uploads. Try again in a while.");

  const processed = await processImage(file.bytes, { maxWidth: 2000, maxHeight: 2000, quality: 80 });
  const attemptNo = (await db.receiptVerification.count({ where: { orderId: current.id } })) + 1;
  const receiptKey = `payment-receipts/${actor.userId}/${current.id}/receipt-${attemptNo}.webp`;
  await storage.put(receiptKey, processed.full, "image/webp");

  const previousKey = current.receiptKey;
  await db.$transaction(async (tx) => {
    await lockCustomer(tx, actor.userId);
    const fresh = await ownedOrder(tx, actor, orderId);
    if (fresh.status !== "AWAITING_PAYMENT") throw new InvalidStateError("This order can't take a receipt any more.");
    await tx.subscriptionOrder.update({ where: { id: fresh.id }, data: { receiptKey, receiptSize: processed.full.byteLength } });
  });
  if (previousKey && previousKey !== receiptKey) await storage.delete([previousKey]).catch(() => undefined);

  // OCR on the stored (re-encoded) image, so what was checked is exactly what the admin will see.
  const verification = await runVerification(db, current, processed.full, { engine: deps.engine, now });
  return { id: current.id, check: toCustomerCheckDto(verification) };
}

/** Submit for review: AWAITING_PAYMENT → SUBMITTED. Needs an attached receipt. Submitting twice is a no-op. */
export async function submitOrderRow(actor: Actor, orderId: string, deps: { db?: Db; now?: Date } = {}): Promise<{ id: string }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lockCustomer(tx, actor.userId);
    const current = await ownedOrder(tx, actor, orderId);
    if (current.status === "SUBMITTED") return { id: current.id };
    if (current.status === "AWAITING_PAYMENT" && current.expiresAt.getTime() <= now.getTime()) {
      await tx.subscriptionOrder.update({ where: { id: current.id }, data: { status: "EXPIRED" } });
      throw new InvalidStateError("This order has expired. Start a new one from Membership.");
    }
    assertTransition(current.status, "SUBMITTED");
    if (!current.receiptKey) throw new InvalidStateError("Upload your transfer receipt first.");
    await tx.subscriptionOrder.update({ where: { id: current.id }, data: { status: "SUBMITTED", submittedAt: now } });
    return { id: current.id };
  });
}

export { submitOrderRow as submitOrder };

/** All OCR passes over an order's receipts, newest first (admin). */
export async function listVerifications(db: DbLike, orderId: string): Promise<AdminReceiptVerificationDto[]> {
  const rows = await db.receiptVerification.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });
  return rows.map(toAdminVerificationDto);
}

/**
 * Admin "Re-run OCR": reads the stored receipt again with the current parsers and appends a new verification row. The
 * order's status, the decision and the entitlement are untouched. Audited; 10 per admin per hour.
 */
export async function reprocessReceipt(admin: AdminActor, orderId: string, deps: { db?: Db; storage?: StorageProvider & { read?: (key: string) => Promise<Uint8Array | null> }; now?: Date; engine?: OcrEngine; fetchImage?: (key: string) => Promise<Uint8Array | null> } = {}): Promise<AdminReceiptVerificationDto> {
  assertPermission(admin, "payments.review");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const order = await db.subscriptionOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Order");
  if (!order.receiptKey) throw new InvalidStateError("This order has no receipt to read.");
  const limit = await consumeRateLimit(db, `billing:ocr-rerun:${admin.userId}`, RECEIPT_RULES.rerunsPerHour, 3_600_000, now);
  if (!limit.allowed) throw new ValidationError("Too many OCR re-runs this hour. Try again later.");

  const fetchImage = deps.fetchImage ?? (await defaultFetcher(deps.storage));
  const image = await fetchImage(order.receiptKey);
  if (!image) throw new InvalidStateError("The stored receipt could not be read.");
  const before = await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
  const verification = await runVerification(db, order, image, { engine: deps.engine, now, triggeredById: admin.userId });
  await writeAudit(db, {
    actorId: admin.userId,
    action: AUDIT_ACTIONS.receiptReprocessed,
    targetType: "SubscriptionOrder",
    targetId: order.id,
    data: { reference: order.reference, attempt: verification.attempt, parserVersion: verification.parserVersion, outcome: verification.outcome, orderStatus: before.status },
    now,
  });
  return toAdminVerificationDto(verification);
}

/** The stored bytes: the local provider reads from disk; the hosted provider goes through a signed URL. */
async function defaultFetcher(storage?: StorageProvider & { read?: (key: string) => Promise<Uint8Array | null> }): Promise<(key: string) => Promise<Uint8Array | null>> {
  const provider = storage ?? getStorageProvider();
  const readable = provider as StorageProvider & { read?: (k: string) => Promise<Uint8Array | null> };
  if (typeof readable.read === "function") return (key) => readable.read!(key);
  return async (key) => {
    const url = await provider.getReadUrl(key, 60);
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  };
}

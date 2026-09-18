/**
 * OCR-assisted receipt verification end to end (docs/ARCHITECTURE.md §12.14): attach → read → verify → persist,
 * duplicate detection across orders and customers, what each audience may see, what a customer cannot forge, that
 * no OCR outcome ever grants Plus, admin re-runs, safe logging, receipt privacy. One case runs the real Tesseract
 * engine on a rendered fixture; every other case uses a stub engine that returns fixture text.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { AUDIT_ACTIONS } from "@/server/admin/audit";
import { AdminAccessError, type AdminActor } from "@/server/admin/authz";
import { approveOrder, getOrderForAdmin, listOrdersForAdmin } from "@/server/billing/approval";
import { attachReceiptToOrder, createOrder, getOrderForActor, submitOrderForActor, submitReceipt } from "@/server/billing/orders";
import { createPaymentMethod } from "@/server/billing/payment-methods";
import { createPlan } from "@/server/billing/plans";
import { attachReceipt, hashTransactionId, listVerifications, RECEIPT_RULES, reprocessReceipt, submitOrder } from "@/server/billing/receipts";
import { getEntitlements } from "@/server/entitlements";
import { getMembership } from "@/server/entitlements/presentation";
import { brokenEngine, tesseractEngine, textEngine, type OcrEngine } from "@/server/ocr/engine";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, hours, type TestUser } from "../helpers/factory";
import * as F from "../fixtures/receipts";

const db = testDb();
const T0 = new Date("2026-09-18T08:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage-ocr", "y".repeat(32));

const PLAN = { code: "MONTHLY", name: "1 month", intervalDays: 30, priceMinor: 19_900, currency: "MVR", active: true, isPlaceholderPrice: false, sortOrder: 1 };
const BML_METHOD = { label: "BML account", bankName: "Bank of Maldives", accountHolder: F.HOLDER, accountNumber: F.BML_ACCOUNT, currency: "MVR", instructions: "Use the reference as the remark.", enabled: true, sortOrder: 0 };

async function makeAdmin(role: "ADMIN" | "MODERATOR" = "ADMIN"): Promise<AdminActor> {
  const u = await createUser(db, { now: T0 });
  await db.user.update({ where: { id: u.userId }, data: { role } });
  return { userId: u.userId, role };
}
async function shop(method = BML_METHOD) {
  const admin = await makeAdmin();
  const plan = await createPlan(admin, PLAN, { db, now: T0 });
  await createPaymentMethod(admin, method, { db, now: T0 });
  return { admin, plan };
}
let cachedImage: Buffer | null = null;
async function image(): Promise<{ bytes: Uint8Array; size: number }> {
  cachedImage ??= await F.renderReceipt(F.BML_SUCCESS);
  return { bytes: new Uint8Array(cachedImage), size: cachedImage.byteLength };
}
const stub = (text: string): OcrEngine => textEngine(text, 94, "stub");

/** Fixture texts carry the placeholder reference; the receipt must carry THIS order's reference to be a match. */
async function withReference(orderId: string, text: string): Promise<string> {
  const row = await db.subscriptionOrder.findUniqueOrThrow({ where: { id: orderId }, select: { reference: true } });
  return text.replace(F.ORDER_REF, row.reference);
}
async function attach(customer: TestUser, orderId: string, text: string, now = at(T0, hours(1))) {
  return attachReceiptToOrder(customer, orderId, await image(), { db, storage, now, engine: stub(await withReference(orderId, text)) });
}

beforeEach(() => resetDb(db));
afterEach(() => vi.restoreAllMocks());
afterAll(() => disconnectDb());

describe("reading a receipt at upload", () => {
  it("1/2 · the real Tesseract engine reads a rendered BML receipt to a full MATCH, and the row records engine and parser", async () => {
    const { plan } = await shop();
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const png = await F.renderReceipt(F.BML_SUCCESS.replace(F.ORDER_REF, order.reference));
    const r = await attachReceiptToOrder(customer, order.id, { bytes: new Uint8Array(png), size: png.byteLength }, { db, storage, now: at(T0, hours(1)), engine: tesseractEngine() });
    expect(r.check.outcome).toBe("MATCH");
    expect(r.order.status).toBe("AWAITING_PAYMENT");
    const row = await db.receiptVerification.findFirstOrThrow({ where: { orderId: order.id } });
    expect(row).toMatchObject({ attempt: 1, parserVersion: "bml-v1", detectedBank: "BML", transactionStatus: "COMPLETED", amountMinor: 19_900, currency: "MVR", transactionId: "BLAZ728811340921", recipientAccount: F.BML_ACCOUNT, outcome: "MATCH" });
    expect(row.engine).toMatch(/^tesseract\.js-7/);
    expect(row.transactionIdHash).toBe(hashTransactionId("BLAZ728811340921"));
    expect(row.durationMs).toBeGreaterThan(0);
  }, 60_000);

  it("4/7 · an MIB 'Processed' history screenshot against an MIB method is a MATCH; the order stays unsubmitted until the customer says so", async () => {
    const { plan } = await shop({ ...BML_METHOD, label: "MIB account", bankName: "Maldives Islamic Bank", accountNumber: F.MIB_ACCOUNT });
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const r = await attach(customer, order.id, F.MIB_PROCESSED);
    expect(r.check).toMatchObject({ outcome: "MATCH", title: "Transfer details detected" });
    expect(r.order).toMatchObject({ status: "AWAITING_PAYMENT", hasReceipt: true });
    expect(r.order.check?.outcome).toBe("MATCH");
    expect((await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } })).submittedAt).toBeNull();
    const submitted = await submitOrderForActor(customer, order.id, { db, now: at(T0, hours(2)) });
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.check?.outcome).toBe("MATCH");
  });

  it("8/9/11/14 · wrong amount, wrong currency, wrong recipient and wrong reference are each reported to the customer with fixed wording", async () => {
    const { plan } = await shop();
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const amount = await attach(customer, order.id, F.BML_WRONG_AMOUNT);
    expect(amount.check.outcome).toBe("MISMATCH");
    expect(amount.check.checks.find((c) => c.key === "amount")).toMatchObject({ state: "MISMATCH", detected: "MVR 150", expected: "MVR 199" });
    const recipient = await attach(customer, order.id, F.BML_WRONG_RECIPIENT);
    expect(recipient.check.checks.find((c) => c.key === "recipient")).toMatchObject({ state: "MISMATCH", detected: null, message: "The receipt shows a different destination account." });
    const reference = await attach(customer, order.id, F.BML_WRONG_REFERENCE);
    expect(reference.check.outcome).toBe("REVIEW_REQUIRED");
    expect(reference.check.checks.find((c) => c.key === "reference")?.state).toBe("MISMATCH");
    // Replacing the slip three times left three readings and one current receipt key (attempt 3).
    expect(await db.receiptVerification.count({ where: { orderId: order.id } })).toBe(3);
    const row = await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.receiptKey).toBe(`payment-receipts/${customer.userId}/${order.id}/receipt-3.webp`);
    expect(await storage.read(`payment-receipts/${customer.userId}/${order.id}/receipt-1.webp`)).toBeNull();
    expect(await storage.read(row.receiptKey!)).not.toBeNull();
  });

  it("13 · a missing Thundi reference does not fail the check", async () => {
    const { plan } = await shop();
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const r = await attach(customer, order.id, F.BML_MISSING_REFERENCE);
    expect(r.check.outcome).toBe("MATCH");
    expect(r.check.checks.find((c) => c.key === "reference")).toMatchObject({ state: "NOT_FOUND" });
  });

  it("20 · when the OCR engine is down the receipt is still attached and submittable; the wording never says the payment failed", async () => {
    const { plan } = await shop();
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await attachReceiptToOrder(customer, order.id, await image(), { db, storage, now: at(T0, hours(1)), engine: brokenEngine("worker crashed") });
    expect(r.check.outcome).toBe("OCR_FAILED");
    expect(r.check.title).toBe("We couldn't automatically verify the transfer details");
    expect(JSON.stringify(r.check).toLowerCase()).not.toContain("payment failed");
    expect(r.check.checks).toEqual([]);
    expect(warn).toHaveBeenCalled();
    const submitted = await submitOrderForActor(customer, order.id, { db, now: at(T0, hours(2)) });
    expect(submitted.status).toBe("SUBMITTED");
    const row = await db.receiptVerification.findFirstOrThrow({ where: { orderId: order.id } });
    expect(row).toMatchObject({ outcome: "OCR_FAILED", parserVersion: "none", transactionId: null });
  });

  it("21 · an unrelated image and an empty reading fall back safely; a PDF or HEIC gets an explicit message; a malformed file is refused", async () => {
    const { plan } = await shop();
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const unrelated = await F.renderUnrelatedImage();
    const r = await attachReceiptToOrder(customer, order.id, { bytes: new Uint8Array(unrelated), size: unrelated.byteLength }, { db, storage, now: at(T0, hours(1)), engine: stub(F.UNRELATED) });
    expect(r.check.outcome).toBe("UNSUPPORTED_RECEIPT");
    // The engine read the picture and found no text at all: that is about the picture, not about us.
    const blank = await attach(customer, order.id, "   \n  ");
    expect(blank.check.outcome).toBe("UNSUPPORTED_RECEIPT");
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(600).fill(0x20)]);
    await expect(attachReceipt(customer, order.id, { bytes: pdf, size: pdf.byteLength }, { db, storage, engine: stub("") })).rejects.toThrow(/PDF receipts aren't supported/);
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic"), ...new Array(600).fill(0)]);
    await expect(attachReceipt(customer, order.id, { bytes: heic, size: heic.byteLength }, { db, storage, engine: stub("") })).rejects.toThrow(/HEIC photos aren't supported yet/);
    await expect(attachReceipt(customer, order.id, { bytes: new Uint8Array([1, 2, 3, 4, 5]), size: 5 }, { db, storage, engine: stub("") })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.receiptVerification.count({ where: { orderId: order.id } })).toBe(2);
    // Submitting without any receipt is refused.
    const bare = await createOrder(await createUser(db, { now: T0 }), { planId: plan.id }, { db, now: T0 });
    await expect(submitOrder({ userId: bare.id ? (await db.subscriptionOrder.findUniqueOrThrow({ where: { id: bare.id } })).userId : "" }, bare.id, { db })).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe("duplicate detection", () => {
  it("16/17 · the same bank transaction number on another customer's order is flagged to the admin with the other order, and to the customer with nothing about it", async () => {
    const { plan, admin } = await shop();
    const a = await createUser(db, { now: T0, name: "Alpha" });
    const b = await createUser(db, { now: T0, name: "Bravo" });
    const orderA = await createOrder(a, { planId: plan.id }, { db, now: T0 });
    const first = await attach(a, orderA.id, F.BML_SUCCESS);
    expect(first.check.outcome).toBe("MATCH");
    await submitOrderForActor(a, orderA.id, { db, now: at(T0, hours(1)) });
    const orderB = await createOrder(b, { planId: plan.id }, { db, now: at(T0, hours(2)) });
    const second = await attach(b, orderB.id, F.BML_SUCCESS.replace(F.ORDER_REF, orderB.reference), at(T0, hours(3)));
    expect(second.check.outcome).toBe("REVIEW_REQUIRED");
    const dup = second.check.checks.find((c) => c.key === "duplicate");
    expect(dup).toMatchObject({ state: "MISMATCH", detected: null, message: "This receipt looks like one that was already submitted. Our team will check." });
    const customerJson = JSON.stringify(second);
    expect(customerJson).not.toContain(orderA.reference);
    expect(customerJson).not.toContain(a.userId);
    expect(customerJson).not.toContain("Alpha");
    expect(customerJson).not.toContain("AISHATH");
    expect(customerJson).not.toContain("meta");
    // The admin sees the link.
    await submitOrderForActor(b, orderB.id, { db, now: at(T0, hours(3)) });
    const adminView = await getOrderForAdmin(admin, orderB.id, { db, storage, now: at(T0, hours(4)) });
    expect(adminView.verification?.checks.duplicate).toMatchObject({ state: "MISMATCH", meta: { orderId: orderA.id, reference: orderA.reference, status: "SUBMITTED", sameCustomer: false } });
    expect(adminView.approvalNeedsReason).toBe(true);
    // The first order is unaffected: its reading still says the number was unseen at the time.
    const firstRow = await db.receiptVerification.findFirstOrThrow({ where: { orderId: orderA.id } });
    expect((firstRow.checks as { duplicate: { state: string } }).duplicate.state).toBe("MATCH");
  });
  it("the same customer uploading the same slip to a second order is flagged as 'same customer'", async () => {
    const { plan, admin } = await shop();
    const a = await createUser(db, { now: T0 });
    const first = await createOrder(a, { planId: plan.id }, { db, now: T0 });
    await submitReceipt(a, first.id, await image(), { db, storage, now: T0, engine: stub(F.BML_SUCCESS) });
    await approveOrder(admin, first.id, { db, now: at(T0, hours(1)) });
    const second = await createOrder(a, { planId: plan.id }, { db, now: at(T0, hours(2)) });
    const r = await attach(a, second.id, F.BML_SUCCESS, at(T0, hours(3)));
    expect(r.check.checks.find((c) => c.key === "duplicate")?.state).toBe("MISMATCH");
    const row = await db.receiptVerification.findFirstOrThrow({ where: { orderId: second.id } });
    expect((row.checks as { duplicate: { meta: { sameCustomer: boolean; status: string } } }).duplicate.meta).toMatchObject({ sameCustomer: true, status: "APPROVED" });
  });
  it("two receipts with the same number arriving at once cannot both be recorded as unseen", async () => {
    const { plan } = await shop();
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    const orderA = await createOrder(a, { planId: plan.id }, { db, now: T0 });
    const orderB = await createOrder(b, { planId: plan.id }, { db, now: T0 });
    const [ra, rb] = await Promise.all([attach(a, orderA.id, F.BML_SUCCESS), attach(b, orderB.id, F.BML_SUCCESS)]);
    const flagged = [ra, rb].filter((r) => r.check.checks.some((c) => c.key === "duplicate" && c.state === "MISMATCH"));
    expect(flagged.length).toBeGreaterThanOrEqual(1);
  });
});

describe("nothing the customer sends can shape the reading, and no reading grants Plus", () => {
  it("22/23/24/25 · the customer's inputs are a file and an order id; detected values, ids and outcomes come only from the server", async () => {
    const { plan } = await shop();
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const r = await attach(customer, order.id, F.BML_WRONG_AMOUNT);
    expect(r.check.outcome).toBe("MISMATCH");
    // Extra properties on the only two customer entry points are ignored by construction (they are not read).
    const forged = { orderId: order.id, check: { outcome: "MATCH" }, outcome: "MATCH", amountMinor: 19_900, transactionId: "FORGED123456", status: "APPROVED" };
    const submitted = await submitOrderForActor(customer, (forged as { orderId: string }).orderId, { db, now: at(T0, hours(2)) });
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.check?.outcome).toBe("MISMATCH");
    const row = await db.receiptVerification.findFirstOrThrow({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
    expect(row.amountMinor).toBe(15_000);
    expect(row.transactionId).toBe("BLAZ728811340921");
    expect(row.outcome).toBe("MISMATCH");
    // The upload route reads exactly one form field.
    const route = readFileSync(path.join(process.cwd(), "src/app/api/payments/[orderId]/receipt/route.ts"), "utf8");
    expect(route.match(/form\.get\(/g)).toHaveLength(1);
    expect(route).toContain('form.get("file")');
    // Another customer cannot attach to, submit or read this order.
    const other = await createUser(db, { now: T0 });
    await expect(attach(other, order.id, F.BML_SUCCESS)).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitOrderForActor(other, order.id, { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getOrderForActor(other, order.id, { db })).rejects.toBeInstanceOf(NotFoundError);
    // Attaching after submission is refused: the reviewed receipt cannot be swapped.
    await expect(attach(customer, order.id, F.BML_SUCCESS, at(T0, hours(3)))).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("26/27/28/29 · MATCH grants nothing, MISMATCH grants nothing, only admin approval activates Plus, and approval stays idempotent", async () => {
    const { plan, admin } = await shop();
    const admin2 = await makeAdmin();
    const good = await createUser(db, { now: T0 });
    const bad = await createUser(db, { now: T0 });
    const goodOrder = await createOrder(good, { planId: plan.id }, { db, now: T0 });
    const badOrder = await createOrder(bad, { planId: plan.id }, { db, now: T0 });
    expect((await attach(good, goodOrder.id, F.BML_SUCCESS)).check.outcome).toBe("MATCH");
    expect((await attach(bad, badOrder.id, F.BML_WRONG_AMOUNT)).check.outcome).toBe("MISMATCH");
    for (const u of [good, bad]) {
      expect((await getEntitlements(db, u.userId, at(T0, hours(2)))).tier).toBe("FREE");
      expect(await db.subscription.count({ where: { userId: u.userId } })).toBe(0);
    }
    await submitOrderForActor(good, goodOrder.id, { db, now: at(T0, hours(2)) });
    await submitOrderForActor(bad, badOrder.id, { db, now: at(T0, hours(2)) });
    expect((await getEntitlements(db, good.userId, at(T0, hours(3)))).tier).toBe("FREE");
    expect(await db.subscription.count()).toBe(0);
    // A matching receipt still needs a human: no reason required, one subscription, idempotent under concurrency.
    const results = await Promise.all([approveOrder(admin, goodOrder.id, { db, now: at(T0, hours(4)) }), approveOrder(admin2, goodOrder.id, { db, now: at(T0, hours(4)) })]);
    expect(results.filter((r) => !r.alreadyApproved)).toHaveLength(1);
    expect(await db.subscription.count({ where: { userId: good.userId } })).toBe(1);
    expect((await getEntitlements(db, good.userId, at(T0, hours(5)))).tier).toBe("PLUS");
    // A mismatching receipt can be approved only with a recorded reason; the audit row carries both.
    await expect(approveOrder(admin, badOrder.id, { db, now: at(T0, hours(4)) })).rejects.toBeInstanceOf(ValidationError);
    await expect(approveOrder(admin, badOrder.id, { db, now: at(T0, hours(4)), reason: "no" })).rejects.toBeInstanceOf(ValidationError);
    expect((await getEntitlements(db, bad.userId, at(T0, hours(5)))).tier).toBe("FREE");
    const approved = await approveOrder(admin, badOrder.id, { db, now: at(T0, hours(6)), reason: "Found MVR 199 in the statement; customer sent two transfers, this slip is the first one." });
    expect(approved.order.status).toBe("APPROVED");
    expect((await getEntitlements(db, bad.userId, at(T0, hours(7)))).tier).toBe("PLUS");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.paymentApproved, targetId: badOrder.id } });
    expect(audit.data).toMatchObject({ receiptOutcome: "MISMATCH", overrideReason: expect.stringContaining("statement") });
    const goodAudit = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.paymentApproved, targetId: goodOrder.id } });
    expect(goodAudit.data).toMatchObject({ receiptOutcome: "MATCH", overrideReason: null });
  });
});

describe("admin re-run, privacy and logging", () => {
  it("33 · re-running OCR is admin-only, rate-limited, audited, appends a reading and changes no state", async () => {
    const { plan, admin } = await shop();
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    await attach(customer, order.id, F.BML_WRONG_AMOUNT);
    await submitOrderForActor(customer, order.id, { db, now: at(T0, hours(1)) });
    const good = stub(await withReference(order.id, F.BML_SUCCESS));
    await expect(reprocessReceipt(await makeAdmin("MODERATOR"), order.id, { db, storage, engine: good })).rejects.toBeInstanceOf(AdminAccessError);
    await expect(reprocessReceipt({ userId: customer.userId, role: "USER" as unknown as "ADMIN" }, order.id, { db, storage, engine: good })).rejects.toBeInstanceOf(Error);
    const rerun = await reprocessReceipt(admin, order.id, { db, storage, now: at(T0, hours(2)), engine: good });
    expect(rerun).toMatchObject({ attempt: 2, outcome: "MATCH", triggeredById: admin.userId });
    const history = await listVerifications(db, order.id);
    expect(history.map((h) => [h.attempt, h.outcome])).toEqual([[2, "MATCH"], [1, "MISMATCH"]]);
    const row = await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe("SUBMITTED");
    expect(await db.subscription.count()).toBe(0);
    expect((await getEntitlements(db, customer.userId, at(T0, hours(3)))).tier).toBe("FREE");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.receiptReprocessed, targetId: order.id } });
    expect(audit).toMatchObject({ actorId: admin.userId });
    expect(audit.data).toMatchObject({ attempt: 2, parserVersion: "bml-v1", outcome: "MATCH", orderStatus: "SUBMITTED" });
    for (let i = 0; i < RECEIPT_RULES.rerunsPerHour - 1; i += 1) await reprocessReceipt(admin, order.id, { db, storage, now: at(T0, hours(2) + i + 1), engine: good });
    await expect(reprocessReceipt(admin, order.id, { db, storage, now: at(T0, hours(2) + 30), engine: good })).rejects.toBeInstanceOf(ValidationError);
    // A decided order can be re-read for the record, and stays decided.
    const detail = await getOrderForAdmin(admin, order.id, { db, storage, now: at(T0, hours(3)) });
    expect(detail.verificationHistory.length).toBeGreaterThanOrEqual(RECEIPT_RULES.rerunsPerHour + 1);
    expect(detail.approvalNeedsReason).toBe(false);
  });

  it("30/31 · the receipt stays private: no key in any DTO, the signed URL expires, and the customer cannot see the admin fields", async () => {
    const { plan, admin } = await shop();
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    await attach(customer, order.id, F.BML_SUCCESS);
    const mine = await getOrderForActor(customer, order.id, { db, storage, now: at(T0, hours(1)), withReceipt: true });
    expect(mine.receiptUrl).toMatch(/^\/api\/media\/payment-receipts\/.*\?exp=\d+&sig=/);
    const exp = Number(new URL(`http://x${mine.receiptUrl}`).searchParams.get("exp"));
    expect(exp * 1000 - Date.now()).toBeLessThanOrEqual(RECEIPT_RULES.urlTtlSeconds * 1000 + 1000);
    const key = `payment-receipts/${customer.userId}/${order.id}/receipt-1.webp`;
    const sig = new URL(`http://x${mine.receiptUrl}`).searchParams.get("sig")!;
    expect(storage.verify(key, exp, sig, Date.now())).toBe(true);
    expect(storage.verify(key, exp, sig, (exp + 1) * 1000)).toBe(false);
    expect(storage.verify(key, exp, "tampered", Date.now())).toBe(false);
    const customerJson = JSON.stringify(mine);
    for (const secret of ["receiptKey", "senderName", "AISHATH", "recipientAccount", "meta", "parserVersion", "BLAZ728811340921"]) expect(customerJson).not.toContain(secret);
    const membership = await getMembership(customer, { db, now: at(T0, hours(1)) });
    expect(membership.currentOrder?.check?.outcome).toBe("MATCH");
    expect(JSON.stringify(membership)).not.toContain("BLAZ728811340921");
    // The admin sees the detected fields but still no storage key.
    await submitOrderForActor(customer, order.id, { db, now: at(T0, hours(1)) });
    const detail = await getOrderForAdmin(admin, order.id, { db, storage, now: at(T0, hours(2)) });
    expect(detail.verification).toMatchObject({ transactionId: "BLAZ728811340921", senderName: "AISHATH TEST", recipientAccount: F.BML_ACCOUNT, detectedBank: "BML" });
    expect(JSON.stringify(detail)).not.toContain("receiptKey");
    const queue = await listOrdersForAdmin(admin, "pending", { db, now: at(T0, hours(2)) });
    expect(queue.items[0]?.verification?.outcome).toBe("MATCH");
  });

  it("32 · production logs carry counts and outcomes, never the receipt's text", async () => {
    const { plan } = await shop();
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    await attach(customer, order.id, F.BML_SUCCESS);
    expect(lines.some((l) => l.startsWith("[ocr] completed"))).toBe(true);
    expect(lines.some((l) => l.includes("bank=BML") && l.includes("amountParsed=true"))).toBe(true);
    const all = lines.join("\n");
    for (const secret of ["BLAZ728811340921", "AISHATH", F.BML_ACCOUNT, "199.00", "THU-7K4P2M", "Bank of Maldives"]) expect(all).not.toContain(secret);
  });
});

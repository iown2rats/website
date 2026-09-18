/**
 * Plus purchase by bank transfer: plans, payment methods, orders, receipts, approval, entitlement, renewal, expiry
 * (docs/ARCHITECTURE.md §12.10–§12.12). Concurrency cases run real parallel transactions against Postgres.
 */
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { COMMUNITY } from "@/config/product";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashPhone } from "@/lib/hashing";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { AUDIT_ACTIONS } from "@/server/admin/audit";
import { AdminAccessError, type AdminActor } from "@/server/admin/authz";
import { approveOrder, computePeriod, getOrderForAdmin, listOrdersForAdmin, MANUAL_PROVIDER, rejectOrder } from "@/server/billing/approval";
import { findSubscriptionsEndingWithin, markExpiredSubscriptions, notifyExpiringSubscriptions } from "@/server/billing/expiry";
import { cancelOrder, createOrder, expireStaleOrders, getCurrentOrderForActor, getOrderForActor, listOrdersForActor, ORDER_RULES, submitReceipt } from "@/server/billing/orders";
import { createPaymentMethod, getCheckoutPaymentMethod, updatePaymentMethod } from "@/server/billing/payment-methods";
import { createPlan, isPlanForSale, listSellablePlans, updatePlan } from "@/server/billing/plans";
import { adjustSubscriptionPeriod, listSubscriptionsForAdmin } from "@/server/billing/subscriptions";
import { getEntitlements } from "@/server/entitlements";
import { setOcrEngine, textEngine } from "@/server/ocr/engine";
import { getMembership } from "@/server/entitlements/presentation";
import { addContactHashes } from "@/server/privacy/contact-hashes";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createSubscription, createUser, hours, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-18T00:00:00Z");
const days = (n: number) => n * 24 * 3_600_000;
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));

async function makeAdmin(role: "ADMIN" | "MODERATOR" = "ADMIN"): Promise<AdminActor> {
  const u = await createUser(db, { now: T0 });
  await db.user.update({ where: { id: u.userId }, data: { role } });
  return { userId: u.userId, role };
}

const PLAN = { code: "MONTHLY", name: "1 month", intervalDays: 30, priceMinor: 14_900, currency: "MVR", active: true, isPlaceholderPrice: false, sortOrder: 1 };
const METHOD = { label: "Main account", bankName: "Test Bank", accountHolder: "Mellocrush Pvt Ltd", accountNumber: "7701234567890", currency: "MVR", instructions: "Use the reference as the remark.", enabled: true, sortOrder: 0 };

async function setUpShop(admin: AdminActor) {
  const plan = await createPlan(admin, PLAN, { db, now: T0 });
  const method = await createPaymentMethod(admin, METHOD, { db, now: T0 });
  return { plan, method };
}

async function receipt(): Promise<{ bytes: Uint8Array; size: number }> {
  const bytes = new Uint8Array(await sharp({ create: { width: 900, height: 1400, channels: 3, background: { r: 240, g: 240, b: 240 } } }).jpeg().toBuffer());
  return { bytes, size: bytes.byteLength };
}

async function submittedOrder(customer: TestUser, planId: string, now = T0) {
  const order = await createOrder(customer, { planId }, { db, now });
  return submitReceipt(customer, order.id, await receipt(), { db, storage, now });
}

// These tests are about orders and approval, not reading receipts: a stub engine that returns no text keeps them fast.
beforeAll(() => setOcrEngine(textEngine("")));
beforeEach(() => resetDb(db));
afterAll(async () => {
  setOcrEngine(undefined);
  await disconnectDb();
});

describe("plans and payment methods (admin)", () => {
  it("only an admin with the permission may manage them; changes are audited with before/after", async () => {
    const admin = await makeAdmin();
    const mod = await makeAdmin("MODERATOR");
    await expect(createPlan(mod, PLAN, { db })).rejects.toBeInstanceOf(AdminAccessError);
    await expect(createPaymentMethod(mod, METHOD, { db })).rejects.toBeInstanceOf(AdminAccessError);
    const { plan, method } = await setUpShop(admin);
    expect(plan.forSale).toBe(true);
    expect(plan.priceLabel).toBe("MVR 149");
    const updated = await updatePlan(admin, plan.id, { ...PLAN, priceMinor: 19_900 }, { db, now: at(T0, 1000) });
    expect(updated.priceMinor).toBe(19_900);
    const planAudit = await db.auditLog.findMany({ where: { targetType: "SubscriptionPlan", targetId: plan.id }, orderBy: { createdAt: "asc" } });
    expect(planAudit.map((a) => a.action)).toEqual([AUDIT_ACTIONS.planCreated, AUDIT_ACTIONS.planUpdated]);
    expect(planAudit[1]!.data).toMatchObject({ before: { priceMinor: 14_900 }, after: { priceMinor: 19_900 } });
    await updatePaymentMethod(admin, method.id, { ...METHOD, enabled: false }, { db, now: at(T0, 2000) });
    const methodAudit = await db.auditLog.findMany({ where: { targetType: "PaymentMethod", targetId: method.id }, orderBy: { createdAt: "asc" } });
    expect(methodAudit.map((a) => a.action)).toEqual([AUDIT_ACTIONS.paymentMethodCreated, AUDIT_ACTIONS.paymentMethodUpdated]);
    expect(JSON.stringify(methodAudit)).not.toContain(METHOD.accountNumber); // only the last four digits are logged
    expect(methodAudit[1]!.data).toMatchObject({ after: { enabled: false, accountNumberLast4: "7890" } });
  });
  it("validates inputs and the for-sale rule; unknown fields are stripped", async () => {
    const admin = await makeAdmin();
    await expect(createPlan(admin, { ...PLAN, isPlaceholderPrice: false, priceMinor: 0 }, { db })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPlan(admin, { ...PLAN, code: "bad code!" }, { db })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPaymentMethod(admin, { ...METHOD, accountNumber: "12" }, { db })).rejects.toBeInstanceOf(ValidationError);
    const plan = await createPlan(admin, { ...PLAN, code: "weekly", extra: "ignored", id: "forged" }, { db });
    expect(plan.code).toBe("WEEKLY");
    expect(plan.id).not.toBe("forged");
    expect(isPlanForSale({ active: true, isPlaceholderPrice: true, priceMinor: 100 })).toBe(false);
    expect(isPlanForSale({ active: false, isPlaceholderPrice: false, priceMinor: 100 })).toBe(false);
    expect((await listSellablePlans(db)).map((p) => p.code)).toEqual([PLAN.code].filter(() => false).concat(["WEEKLY"]));
  });
});

describe("orders", () => {
  it("creates one order with a snapshot and a unique reference; the same plan returns it, another plan replaces it", async () => {
    const admin = await makeAdmin();
    const { plan, method } = await setUpShop(admin);
    const weekly = await createPlan(admin, { ...PLAN, code: "WEEKLY", name: "1 week", intervalDays: 7, priceMinor: 4_900, sortOrder: 0 }, { db, now: T0 });
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    expect(order).toMatchObject({ status: "AWAITING_PAYMENT", planName: "1 month", amountMinor: 14_900, amountLabel: "MVR 149", currency: "MVR", durationDays: 30, method: { bankName: "Test Bank", accountNumber: method.accountNumber, accountHolder: "Mellocrush Pvt Ltd" }, hasReceipt: false, receiptUrl: null, check: null, receiptAttachedAt: null });
    expect(order.reference).toMatch(/^THU-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(new Date(order.expiresAt).getTime()).toBe(T0.getTime() + ORDER_RULES.awaitingPaymentTtlMs);
    const again = await createOrder(customer, { planId: plan.id }, { db, now: at(T0, 1000) });
    expect(again.id).toBe(order.id);
    const switched = await createOrder(customer, { planId: weekly.id }, { db, now: at(T0, 2000) });
    expect(switched.id).not.toBe(order.id);
    expect(switched.planName).toBe("1 week");
    expect((await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect(await db.subscriptionOrder.count({ where: { userId: customer.userId, status: { in: ["AWAITING_PAYMENT", "SUBMITTED"] } } })).toBe(1);
  });
  it("editing the plan or payment method later never rewrites an existing order", async () => {
    const admin = await makeAdmin();
    const { plan, method } = await setUpShop(admin);
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    await updatePlan(admin, plan.id, { ...PLAN, name: "1 month (new)", priceMinor: 99_900, intervalDays: 45 }, { db });
    await updatePaymentMethod(admin, method.id, { ...METHOD, accountNumber: "9999999999999", bankName: "Other Bank" }, { db });
    const same = await getOrderForActor(customer, order.id, { db, now: T0 });
    expect(same).toMatchObject({ planName: "1 month", amountMinor: 14_900, durationDays: 30, method: { bankName: "Test Bank", accountNumber: "7701234567890" } });
  });
  it("refuses plans that are not for sale, disabled payment methods, unfinished, suspended and deleted accounts", async () => {
    const admin = await makeAdmin();
    const { plan, method } = await setUpShop(admin);
    const placeholder = await createPlan(admin, { ...PLAN, code: "TBA", isPlaceholderPrice: true }, { db });
    const disabled = await createPlan(admin, { ...PLAN, code: "OLD", active: false }, { db });
    const customer = await createUser(db, { now: T0 });
    await expect(createOrder(customer, { planId: placeholder.id }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(customer, { planId: disabled.id }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(customer, { planId: "" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    const onboarding = await createUser(db, { now: T0, status: "ONBOARDING" });
    await expect(createOrder(onboarding, { planId: plan.id }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    const suspended = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: suspended.userId }, data: { status: "SUSPENDED" } });
    await expect(createOrder(suspended, { planId: plan.id }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    const deleted = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: deleted.userId }, data: { status: "DELETED" } });
    await expect(createOrder(deleted, { planId: plan.id }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    await updatePaymentMethod(admin, method.id, { ...METHOD, enabled: false }, { db });
    expect(await getCheckoutPaymentMethod(db)).toBeNull();
    await expect(createOrder(customer, { planId: plan.id }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
  });
  it("a customer sees only their own orders; cancelling and expiry follow the state machine", async () => {
    const admin = await makeAdmin();
    const { plan } = await setUpShop(admin);
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    const order = await createOrder(a, { planId: plan.id }, { db, now: T0 });
    await expect(getOrderForActor(b, order.id, { db, now: T0 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelOrder(b, order.id, { db, now: T0 })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listOrdersForActor(b, { db, now: T0 })).length).toBe(0);
    const cancelled = await cancelOrder(a, order.id, { db, now: at(T0, 1000) });
    expect(cancelled.status).toBe("CANCELLED");
    expect((await cancelOrder(a, order.id, { db, now: at(T0, 2000) })).status).toBe("CANCELLED");
    const stale = await createOrder(a, { planId: plan.id }, { db, now: T0 });
    expect(await expireStaleOrders(db, at(T0, ORDER_RULES.awaitingPaymentTtlMs + 1))).toBe(1);
    expect((await getOrderForActor(a, stale.id, { db, now: at(T0, days(8)) })).status).toBe("EXPIRED");
    await expect(submitReceipt(a, stale.id, await receipt(), { db, storage, now: at(T0, days(8)) })).rejects.toBeInstanceOf(InvalidStateError);
    expect((await getCurrentOrderForActor(a, { db, now: at(T0, days(8)) }))).toBeNull();
  });
});

describe("receipts", () => {
  it("uploading a receipt submits the order; the file is private, re-encoded and only reachable by signed URL", async () => {
    const admin = await makeAdmin();
    const { plan } = await setUpShop(admin);
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const submitted = await submitReceipt(customer, order.id, await receipt(), { db, storage, now: at(T0, hours(1)) });
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.hasReceipt).toBe(true);
    expect(submitted.receiptUrl).toBeNull(); // not requested
    const row = await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.receiptKey).toBe(`payment-receipts/${customer.userId}/${order.id}/receipt-1.webp`);
    const stored = await storage.read(row.receiptKey!);
    expect(stored && (await sharp(stored).metadata()).format).toBe("webp");
    const withUrl = await getOrderForActor(customer, order.id, { db, storage, now: T0, withReceipt: true });
    expect(withUrl.receiptUrl).toMatch(/^\/api\/media\/payment-receipts\/.*\?exp=\d+&sig=/);
    expect(JSON.stringify(withUrl)).not.toContain("receiptKey");
    // Nothing about the upload granted Plus.
    expect((await getEntitlements(db, customer.userId, at(T0, hours(2)))).tier).toBe("FREE");
    // Submitting again is idempotent; another customer cannot touch it.
    expect((await submitReceipt(customer, order.id, await receipt(), { db, storage, now: at(T0, hours(2)) })).status).toBe("SUBMITTED");
    const other = await createUser(db, { now: T0 });
    await expect(submitReceipt(other, order.id, await receipt(), { db, storage, now: T0 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getOrderForActor(other, order.id, { db, storage, now: T0, withReceipt: true })).rejects.toBeInstanceOf(NotFoundError);
  });
  it("rejects non-images, oversized files and empty files", async () => {
    const admin = await makeAdmin();
    const { plan } = await setUpShop(admin);
    const customer = await createUser(db, { now: T0 });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    await expect(submitReceipt(customer, order.id, { bytes: new Uint8Array([1, 2, 3]), size: 3 }, { db, storage, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(submitReceipt(customer, order.id, { bytes: new Uint8Array(0), size: 0 }, { db, storage, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(submitReceipt(customer, order.id, { bytes: new Uint8Array(10), size: ORDER_RULES.receiptMaxBytes + 1 }, { db, storage, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    expect((await getOrderForActor(customer, order.id, { db, now: T0 })).status).toBe("AWAITING_PAYMENT");
  });
});

describe("approval and entitlement", () => {
  it("only a permitted admin can approve; approval activates Plus for exactly the purchased duration and notifies", async () => {
    const admin = await makeAdmin();
    const mod = await makeAdmin("MODERATOR");
    const { plan } = await setUpShop(admin);
    const customer = await createUser(db, { now: T0 });
    const order = await submittedOrder(customer, plan.id);
    await expect(approveOrder(mod, order.id, { db, now: T0 })).rejects.toBeInstanceOf(AdminAccessError);
    await expect(approveOrder({ userId: customer.userId, role: "USER" as unknown as "ADMIN" }, order.id, { db })).rejects.toBeInstanceOf(Error);
    expect((await getEntitlements(db, customer.userId, T0)).tier).toBe("FREE"); // pending grants nothing
    const approvedAt = at(T0, hours(3));
    const r = await approveOrder(admin, order.id, { db, now: approvedAt });
    expect(r.alreadyApproved).toBe(false);
    expect(r.order.status).toBe("APPROVED");
    const sub = await db.subscription.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(sub).toMatchObject({ userId: customer.userId, status: "ACTIVE", provider: MANUAL_PROVIDER, currentPeriodStart: approvedAt, currentPeriodEnd: at(approvedAt, days(30)) });
    const e = await getEntitlements(db, customer.userId, at(approvedAt, 1000));
    expect(e.tier).toBe("PLUS");
    expect(e.subscription?.currentPeriodEnd).toEqual(at(approvedAt, days(30)));
    expect((await getEntitlements(db, customer.userId, at(approvedAt, days(30)))).tier).toBe("FREE"); // fails closed at the boundary
    expect(await db.notification.count({ where: { userId: customer.userId, type: "PAYMENT_APPROVED" } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.paymentApproved, targetId: order.id } });
    expect(audit.actorId).toBe(admin.userId);
    expect(audit.data).toMatchObject({ reference: order.reference, amountMinor: 14_900, durationDays: 30 });
  });
  it("is idempotent: a second approval, and two admins approving at once, yield one subscription", async () => {
    const admin = await makeAdmin();
    const admin2 = await makeAdmin();
    const { plan } = await setUpShop(admin);
    const customer = await createUser(db, { now: T0 });
    const order = await submittedOrder(customer, plan.id);
    const results = await Promise.all([approveOrder(admin, order.id, { db, now: T0 }), approveOrder(admin2, order.id, { db, now: T0 }), approveOrder(admin, order.id, { db, now: T0 })]);
    expect(results.filter((r) => !r.alreadyApproved).length).toBe(1);
    expect(results.every((r) => r.order.status === "APPROVED")).toBe(true);
    expect(await db.subscription.count({ where: { userId: customer.userId } })).toBe(1);
    const again = await approveOrder(admin2, order.id, { db, now: at(T0, hours(1)) });
    expect(again.alreadyApproved).toBe(true);
    expect(await db.subscription.count({ where: { userId: customer.userId } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.paymentApproved, targetId: order.id } })).toBe(1);
    expect((await getEntitlements(db, customer.userId, at(T0, days(29)))).subscription?.currentPeriodEnd).toEqual(at(T0, days(30)));
  });
  it("an admin cannot approve their own order, approve a deleted customer, or approve an order that was not submitted", async () => {
    const admin = await makeAdmin();
    const admin2 = await makeAdmin();
    const { plan } = await setUpShop(admin);
    const own = await submittedOrder({ userId: admin.userId, handle: "", phoneE164: "" }, plan.id);
    await expect(approveOrder(admin, own.id, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(rejectOrder(admin, own.id, { reason: "self" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    expect((await approveOrder(admin2, own.id, { db, now: T0 })).order.status).toBe("APPROVED");
    const customer = await createUser(db, { now: T0 });
    const unpaid = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    await expect(approveOrder(admin, unpaid.id, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    const gone = await createUser(db, { now: T0 });
    const goneOrder = await submittedOrder(gone, plan.id);
    await db.user.update({ where: { id: gone.userId }, data: { status: "DELETED" } });
    await expect(approveOrder(admin, goneOrder.id, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(approveOrder(admin, "missing", { db })).rejects.toBeInstanceOf(NotFoundError);
  });
  it("rejection grants nothing, keeps the record, notifies with the reason, and is final", async () => {
    const admin = await makeAdmin();
    const { plan } = await setUpShop(admin);
    const customer = await createUser(db, { now: T0 });
    const order = await submittedOrder(customer, plan.id);
    await expect(rejectOrder(admin, order.id, { reason: "" }, { db })).rejects.toBeInstanceOf(ValidationError);
    const rejected = await rejectOrder(admin, order.id, { reason: "Amount did not match" }, { db, now: at(T0, hours(1)) });
    expect(rejected).toMatchObject({ status: "REJECTED", rejectionReason: "Amount did not match" });
    expect((await getEntitlements(db, customer.userId, at(T0, hours(2)))).tier).toBe("FREE");
    expect(await db.subscription.count({ where: { userId: customer.userId } })).toBe(0);
    expect(await db.notification.count({ where: { userId: customer.userId, type: "PAYMENT_REJECTED" } })).toBe(1);
    await expect(approveOrder(admin, order.id, { db, now: at(T0, hours(2)) })).rejects.toBeInstanceOf(InvalidStateError);
    expect((await rejectOrder(admin, order.id, { reason: "again" }, { db })).status).toBe("REJECTED");
    expect(await db.subscriptionOrder.count({ where: { id: order.id } })).toBe(1);
    // The customer may start a fresh order with a new reference.
    const next = await createOrder(customer, { planId: plan.id }, { db, now: at(T0, hours(3)) });
    expect(next.id).not.toBe(order.id);
    expect(next.reference).not.toBe(order.reference);
    const current = await getCurrentOrderForActor(customer, { db, now: at(T0, hours(3)) });
    expect(current?.id).toBe(next.id);
  });
  it("early renewal starts when the current paid period ends; simultaneous approvals for one customer chain correctly", async () => {
    const admin = await makeAdmin();
    const admin2 = await makeAdmin();
    const { plan } = await setUpShop(admin);
    const customer = await createUser(db, { now: T0 });
    const first = await submittedOrder(customer, plan.id);
    await approveOrder(admin, first.id, { db, now: T0 });
    const renewAt = at(T0, days(10));
    expect(await computePeriod(db, customer.userId, 30, renewAt)).toEqual({ start: at(T0, days(30)), end: at(T0, days(60)) });
    const second = await submittedOrder(customer, plan.id, renewAt);
    // A third order cannot exist while the second is open; force one directly to exercise the per-customer lock.
    const third = await db.subscriptionOrder.create({ data: { ...(await db.subscriptionOrder.findUniqueOrThrow({ where: { id: second.id } })), id: undefined, reference: "THU-ZZZZZ2", status: "SUBMITTED", createdAt: renewAt } as never });
    await Promise.all([approveOrder(admin, second.id, { db, now: renewAt }), approveOrder(admin2, third.id, { db, now: renewAt })]);
    const subs = await db.subscription.findMany({ where: { userId: customer.userId }, orderBy: { currentPeriodEnd: "asc" } });
    expect(subs.map((s) => [s.currentPeriodStart.toISOString(), s.currentPeriodEnd.toISOString()])).toEqual([
      [T0.toISOString(), at(T0, days(30)).toISOString()],
      [at(T0, days(30)).toISOString(), at(T0, days(60)).toISOString()],
      [at(T0, days(60)).toISOString(), at(T0, days(90)).toISOString()],
    ]);
    expect((await getEntitlements(db, customer.userId, at(T0, days(89)))).tier).toBe("PLUS");
    expect((await getEntitlements(db, customer.userId, at(T0, days(90)))).tier).toBe("FREE");
    // A lapsed customer renewing starts fresh from approval time.
    const lapsedAt = at(T0, days(120));
    const late = await db.subscriptionOrder.create({ data: { ...(await db.subscriptionOrder.findUniqueOrThrow({ where: { id: second.id } })), id: undefined, reference: "THU-ZZZZZ3", status: "SUBMITTED", createdAt: lapsedAt } as never });
    await approveOrder(admin, late.id, { db, now: lapsedAt });
    expect((await db.subscription.findUniqueOrThrow({ where: { orderId: late.id } })).currentPeriodStart).toEqual(lapsedAt);
  });
});

describe("admin views, expiry and DTO safety", () => {
  it("lists the queue with customer summaries; the admin DTO carries a receipt URL but no storage key", async () => {
    const admin = await makeAdmin();
    const { plan } = await setUpShop(admin);
    const customer = await createUser(db, { now: T0, name: "Buyer" });
    const order = await submittedOrder(customer, plan.id);
    const pending = await listOrdersForAdmin(admin, "pending", { db, now: T0 });
    expect(pending.total).toBe(1);
    expect(pending.items[0]).toMatchObject({ id: order.id, user: { displayName: "Buyer", handle: customer.handle } });
    const detail = await getOrderForAdmin(admin, order.id, { db, storage, now: T0 });
    expect(detail.receiptUrl).toMatch(/^\/api\/media\//);
    expect(JSON.stringify(detail)).not.toMatch(/receiptKey|providerSubscriptionRef|phone/);
    await expect(listOrdersForAdmin(await makeAdmin("MODERATOR"), "pending", { db })).rejects.toBeInstanceOf(AdminAccessError);
  });
  it("membership DTO shows sellable plans, payment availability and the current order without secrets", async () => {
    const admin = await makeAdmin();
    const { plan } = await setUpShop(admin);
    const customer = await createUser(db, { now: T0 });
    let m = await getMembership(customer, { db, now: T0 });
    expect(m.paymentsAvailable).toBe(true);
    expect(m.plans.find((p) => p.id === plan.id)).toMatchObject({ price: "MVR 149", forSale: true });
    expect(m.currentOrder).toBeNull();
    const order = await submittedOrder(customer, plan.id);
    m = await getMembership(customer, { db, now: at(T0, 1000) });
    expect(m.currentOrder).toMatchObject({ id: order.id, status: "SUBMITTED" });
    expect(m.tier).toBe("FREE");
    expect(JSON.stringify(m)).not.toMatch(/receiptKey|provider|override|priceMinor/);
    await approveOrder(admin, order.id, { db, now: at(T0, 2000) });
    m = await getMembership(customer, { db, now: at(T0, 3000) });
    expect(m.tier).toBe("PLUS");
    expect(m.currentOrder?.status).toBe("APPROVED");
  });
  it("expiry helpers warn once, mark lapsed rows EXPIRED once, and entitlement never depended on them", async () => {
    const customer = await createUser(db, { now: T0 });
    await createSubscription(db, customer.userId, { periodStart: at(T0, -days(28)), periodEnd: at(T0, days(2)) });
    expect((await findSubscriptionsEndingWithin(db, T0, days(3))).length).toBe(1);
    expect(await notifyExpiringSubscriptions(db, T0)).toBe(1);
    expect(await notifyExpiringSubscriptions(db, at(T0, hours(1)))).toBe(0);
    expect((await getEntitlements(db, customer.userId, at(T0, days(2)))).tier).toBe("FREE");
    const r = await markExpiredSubscriptions(db, at(T0, days(2)));
    expect(r).toEqual({ expired: 1, notified: 1 });
    expect(await markExpiredSubscriptions(db, at(T0, days(3)))).toEqual({ expired: 0, notified: 0 });
    expect(await db.notification.count({ where: { userId: customer.userId, type: "SUBSCRIPTION_EXPIRED" } })).toBe(1);
  });
  it("subscription period adjustments need the permission, a reason and are audited", async () => {
    const admin = await makeAdmin();
    const mod = await makeAdmin("MODERATOR");
    const customer = await createUser(db, { now: T0 });
    const sub = await createSubscription(db, customer.userId, { periodStart: T0, periodEnd: at(T0, days(30)) });
    await expect(adjustSubscriptionPeriod(mod, sub.id, { currentPeriodEnd: at(T0, days(40)), reason: "x" }, { db })).rejects.toBeInstanceOf(AdminAccessError);
    await expect(adjustSubscriptionPeriod(admin, sub.id, { currentPeriodEnd: at(T0, days(40)), reason: "" }, { db })).rejects.toBeInstanceOf(ValidationError);
    const adjusted = await adjustSubscriptionPeriod(admin, sub.id, { currentPeriodEnd: at(T0, days(40)).toISOString(), reason: "Goodwill for outage" }, { db, now: T0 });
    expect(adjusted.currentPeriodEnd).toBe(at(T0, days(40)).toISOString());
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.subscriptionAdjusted, targetId: sub.id } });
    expect(audit.data).toMatchObject({ reason: "Goodwill for outage", before: { currentPeriodEnd: at(T0, days(30)).toISOString() }, after: { currentPeriodEnd: at(T0, days(40)).toISOString() } });
    expect((await listSubscriptionsForAdmin(admin, { filter: "active" }, { db, now: T0 })).total).toBe(1);
  });
});

describe("unchanged foundations", () => {
  it("Provider-keyed authentication (Google and Telegram), contact blocking and Invisible Mode + Community semantics are untouched", async () => {
    const providers = await db.$queryRaw<{ v: string }[]>`SELECT unnest(enum_range(NULL::"AuthProvider"))::text AS v`;
    expect(providers.map((p) => p.v)).toEqual(["GOOGLE", "TELEGRAM"]);
    expect(await db.$queryRaw`SELECT to_regclass('"OtpRequest"')::text AS r`).toEqual([{ r: null }]);
    const u = await createUser(db, { now: T0 });
    const digest = Buffer.from(hashPhone("+9607000000")).toString("hex");
    expect(await addContactHashes(u, { hashes: [digest], source: "MANUAL" }, { db, now: T0 })).toMatchObject({ total: 1 });
    expect(Buffer.from(hashPhone("+9607000000")).toString("hex")).toBe(digest);
    expect(COMMUNITY.invisibleModeParticipation).toBe("ALLOWED");
  });
});

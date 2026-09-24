import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { ratio } from "@/components/features/admin/plus-funnel-panel";
import type { AdminActor } from "@/server/admin/authz";
import { getPlusFunnelReport, parsePlusPromptBody, recordPlusEvent } from "@/server/analytics/plus-funnel";
import { approveOrder } from "@/server/billing/approval";
import { CHECKOUT_REMINDER } from "@/config/product";
import { getEmailProvider, resetEmailProviderCache, type ConsoleEmailProvider } from "@/lib/email";
import { reminderCutoff, remindOrder, sweepCheckoutReminders } from "@/server/billing/checkout-reminder";
import { cancelOrder, createOrder, submitReceipt } from "@/server/billing/orders";
import { getNotificationFeed, markLikesSeen } from "@/server/notifications/feed";
import { getNavBadges } from "@/server/notifications/badges";
import { sweepMatchEmails } from "@/server/notifications/engagement-email";
import { markConversationRead } from "@/server/conversations/messages";
import { purgeExpiredAnalytics } from "@/server/analytics/ingest";
import { getDeck, undoAndRestore } from "@/server/discovery/deck";
import { EntitlementRequiredError } from "@/lib/errors";
import { createPaymentMethod } from "@/server/billing/payment-methods";
import { createPlan } from "@/server/billing/plans";
import { setOcrEngine, textEngine } from "@/server/ocr/engine";
import { likeUser, passUser } from "@/server/likes/like";
import { getLikesTeaser, getLikesYou } from "@/server/likes/likes-you";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createIdentity, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

/*
 * Plus promotion (docs/ARCHITECTURE.md §12.19). Every personalised claim must come from the same server rule the
 * real surface uses, and must say nothing personal when there is nothing to say.
 */

const db = testDb();
const T0 = new Date("2026-09-24T09:00:00Z");
const FLAGS = ["PLUS_DISCOVER_PROMPT", "PLUS_UNDO_UI", "PLUS_CHECKOUT_REMINDERS", "PLUS_FUNNEL_ANALYTICS"] as const;

const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));

beforeAll(() => setOcrEngine(textEngine("")));
beforeEach(() => resetDb(db));
afterEach(() => {
  for (const f of FLAGS) delete process.env[f];
});
afterAll(async () => {
  setOcrEngine(undefined);
  await disconnectDb();
});

/** An admin, a customer, one plan for sale and an enabled payment method. */
async function shop() {
  const adminUser = await createUser(db, { now: T0 });
  await db.user.update({ where: { id: adminUser.userId }, data: { role: "ADMIN" } });
  const admin: AdminActor = { userId: adminUser.userId, role: "ADMIN" };
  const plan = await createPlan(admin, { code: "MONTHLY", name: "1 month", intervalDays: 30, priceMinor: 14_900, currency: "MVR", active: true, isPlaceholderPrice: false, sortOrder: 1 }, { db, now: T0 });
  await createPaymentMethod(admin, { label: "Main", bankName: "Test Bank", accountHolder: "MelloCrush Pvt Ltd", accountNumber: "7701234567890", currency: "MVR", instructions: "Use the reference as the remark.", enabled: true, sortOrder: 0 }, { db, now: T0 });
  const customer = await createUser(db, { now: T0 });
  return { admin, customer, plan };
}

async function receipt(): Promise<{ bytes: Uint8Array; size: number }> {
  const bytes = new Uint8Array(await sharp({ create: { width: 900, height: 1400, channels: 3, background: { r: 240, g: 240, b: 240 } } }).jpeg().toBuffer());
  return { bytes, size: bytes.byteLength };
}

async function likedBy(target: TestUser, count: number, now = T0): Promise<TestUser[]> {
  const out: TestUser[] = [];
  for (let i = 0; i < count; i += 1) {
    const liker = await createUser(db, { now, name: `Liker ${i}` });
    await likeUser(liker, target.userId, { db, now });
    out.push(liker);
  }
  return out;
}

async function setPhotos(user: TestUser, rows: { moderation: "APPROVED" | "PENDING" | "REJECTED"; blurhash: string }[]) {
  const profile = await db.profile.findUniqueOrThrow({ where: { userId: user.userId }, select: { id: true } });
  const photos = await db.profilePhoto.findMany({ where: { profileId: profile.id }, orderBy: { position: "asc" } });
  for (let i = 0; i < photos.length; i += 1) {
    const row = rows[i];
    if (row) await db.profilePhoto.update({ where: { id: photos[i]!.id }, data: row });
  }
}

describe("Free Likes You preview: approved photos only", () => {
  it("never derives a preview from a pending photo", async () => {
    const me = await createUser(db, { now: T0 });
    const [liker] = await likedBy(me, 1);
    await setPhotos(liker!, [{ moderation: "PENDING", blurhash: "PENDINGHASH00" }, { moderation: "PENDING", blurhash: "PENDINGHASH01" }]);

    const result = await getLikesYou(me, { db, now: T0 });
    if (result.tier !== "FREE") throw new Error("expected Free");
    expect(result.placeholders).toEqual([{ blurhash: null, verified: false }]);
  });

  it("never derives a preview from a rejected photo", async () => {
    const me = await createUser(db, { now: T0 });
    const [liker] = await likedBy(me, 1);
    await setPhotos(liker!, [{ moderation: "REJECTED", blurhash: "REJECTEDHASH0" }, { moderation: "REJECTED", blurhash: "REJECTEDHASH1" }]);

    const result = await getLikesYou(me, { db, now: T0 });
    if (result.tier !== "FREE") throw new Error("expected Free");
    expect(JSON.stringify(result)).not.toContain("REJECTEDHASH");
    expect(result.placeholders[0]!.blurhash).toBeNull();
  });

  it("uses the first APPROVED photo when the main one is still under review", async () => {
    const me = await createUser(db, { now: T0 });
    const [liker] = await likedBy(me, 1);
    await setPhotos(liker!, [{ moderation: "PENDING", blurhash: "PENDINGHASH00" }, { moderation: "APPROVED", blurhash: "APPROVEDHASH1" }]);

    const result = await getLikesYou(me, { db, now: T0 });
    if (result.tier !== "FREE") throw new Error("expected Free");
    expect(result.placeholders[0]!.blurhash).toBe("APPROVEDHASH1");
    expect(JSON.stringify(result)).not.toContain("PENDINGHASH");
  });
});

describe("Likes You count", () => {
  it("is the real count, not capped at the page size", async () => {
    const me = await createUser(db, { now: T0 });
    await likedBy(me, 53);
    const result = await getLikesYou(me, { db, now: T0 });
    if (result.tier !== "FREE") throw new Error("expected Free");
    expect(result.count).toBe(53);
    // The tiles stay one page, and every one is a real liker.
    expect(result.placeholders).toHaveLength(50);
  });

  it("the teaser and the page agree, under every exclusion the page applies", async () => {
    const me = await createUser(db, { now: T0 });
    const [kept, passedAfter, blocked, likedBack] = await likedBy(me, 4);
    const blindPass = await createUser(db, { now: T0, name: "Blind" });
    await passUser(me, blindPass.userId, { db, now: at(T0, -hours(1)) });
    await likeUser(blindPass, me.userId, { db, now: T0 });

    await passUser(me, passedAfter!.userId, { db, now: at(T0, minutes(5)) });
    await blockUser(me, blocked!.userId, { db, now: at(T0, minutes(5)) });
    await likeUser(me, likedBack!.userId, { db, now: at(T0, minutes(5)) });

    const now = at(T0, minutes(10));
    const page = await getLikesYou(me, { db, now });
    const teaser = await getLikesTeaser(me, { db, now });
    // kept + the blind pass (a pass made BEFORE the like does not hide it).
    expect(page.count).toBe(2);
    expect(teaser).toEqual({ count: 2 });
    expect(kept).toBeTruthy();
  });

  it("is zero, not absent, when nobody likes a Free member — callers must then say nothing personal", async () => {
    const me = await createUser(db, { now: T0 });
    expect(await getLikesTeaser(me, { db, now: T0 })).toEqual({ count: 0 });
  });

  it("is never offered to a Plus member", async () => {
    const me = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await likedBy(me, 3);
    expect(await getLikesTeaser(me, { db, now: T0 })).toBeNull();
  });

  it("returns to a Free prompt when Plus has expired", async () => {
    const me = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(48)), at(T0, -hours(1)));
    await likedBy(me, 2);
    expect(await getLikesTeaser(me, { db, now: T0 })).toEqual({ count: 2 });
  });
});

// ───────────────────────────── Plus funnel analytics ─────────────────────────────

describe("Plus funnel analytics", () => {
  const funnelRows = () => db.plusFunnelEvent.findMany({ orderBy: { createdAt: "asc" } });

  it("writes nothing while PLUS_FUNNEL_ANALYTICS is off, and the report says it is off", async () => {
    const me = await createUser(db, { now: T0 });
    await recordPlusEvent({ event: "plus_prompt_viewed", userId: me.userId, surface: "likes_you" }, { db });
    expect(await funnelRows()).toHaveLength(0);
    expect(await getPlusFunnelReport(hours(24), { db, now: T0 })).toEqual({ enabled: false });
  });

  it("records event + surface and nothing else, once per key", async () => {
    process.env.PLUS_FUNNEL_ANALYTICS = "on";
    const me = await createUser(db, { now: T0 });
    const key = "0b7c2a8e-6a3f-4f55-9d7e-5f3b2c1a0e9d";
    await recordPlusEvent({ event: "plus_prompt_viewed", userId: me.userId, surface: "likes_you", eventKey: key, now: T0 }, { db });
    await recordPlusEvent({ event: "plus_prompt_viewed", userId: me.userId, surface: "likes_you", eventKey: key, now: T0 }, { db });
    const rows = await funnelRows();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["createdAt", "event", "eventKey", "id", "orderId", "surface", "userId"]);
    expect(rows[0]).toMatchObject({ event: "plus_prompt_viewed", surface: "likes_you", userId: me.userId, orderId: null });
  });

  it("drops a surface that is not on the closed list rather than storing it", async () => {
    process.env.PLUS_FUNNEL_ANALYTICS = "on";
    const me = await createUser(db, { now: T0 });
    await recordPlusEvent({ event: "plus_prompt_clicked", userId: me.userId, surface: "<script>" as never }, { db });
    expect((await funnelRows())[0]!.surface).toBeNull();
  });

  it("the database itself refuses an unknown event or surface", async () => {
    await expect(db.$executeRaw`INSERT INTO "PlusFunnelEvent" (id, "eventKey", event) VALUES ('x1', 'k1', 'made_up')`).rejects.toThrow();
    await expect(db.$executeRaw`INSERT INTO "PlusFunnelEvent" (id, "eventKey", event, surface) VALUES ('x2', 'k2', 'plus_prompt_viewed', 'banner')`).rejects.toThrow();
  });

  it("never throws, even when the database does", async () => {
    process.env.PLUS_FUNNEL_ANALYTICS = "on";
    const broken = { $executeRaw: () => Promise.reject(new Error("relation does not exist")) } as unknown as typeof db;
    await expect(recordPlusEvent({ event: "plus_prompt_viewed", userId: "u", surface: "undo" }, { db: broken })).resolves.toBeUndefined();
  });

  it("the browser may report only a view or a tap, with a UUID and a known surface", () => {
    const ok = { eventKey: "0b7c2a8e-6a3f-4f55-9d7e-5f3b2c1a0e9d", event: "plus_prompt_clicked", surface: "daily_limit" };
    expect(parsePlusPromptBody(JSON.stringify(ok))).toEqual(ok);
    for (const bad of [
      { ...ok, event: "plus_payment_approved" },
      { ...ok, surface: "banner" },
      { ...ok, eventKey: "not-a-uuid" },
      { ...ok, likerId: "someone" },
      { ...ok, count: 4 },
    ]) {
      expect(parsePlusPromptBody(JSON.stringify(bad))).toBeNull();
    }
    expect(parsePlusPromptBody("not json")).toBeNull();
    expect(parsePlusPromptBody(JSON.stringify({ ...ok, pad: "x".repeat(600) }))).toBeNull();
  });

  it("approval records one approved step after it commits, and approval still works with the switch on", async () => {
    process.env.PLUS_FUNNEL_ANALYTICS = "on";
    const { admin, customer, plan } = await shop();
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    await submitReceipt(customer, order.id, await receipt(), { db, storage, now: T0 });
    const result = await approveOrder(admin, order.id, { db, now: at(T0, hours(1)) });
    expect(result.alreadyApproved).toBe(false);
    await approveOrder(admin, order.id, { db, now: at(T0, hours(2)) });
    const approved = (await funnelRows()).filter((r) => r.event === "plus_payment_approved");
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({ userId: customer.userId, orderId: order.id, surface: null });
  });

  it("reports raw counts per surface, crediting later steps to the checkout's surface", async () => {
    process.env.PLUS_FUNNEL_ANALYTICS = "on";
    const { admin, customer, plan } = await shop();
    const other = await createUser(db, { now: T0 });
    for (const u of [customer, other]) await recordPlusEvent({ event: "plus_prompt_viewed", userId: u.userId, surface: "likes_you", now: T0 }, { db });
    // A second view by the same member is still one member.
    await recordPlusEvent({ event: "plus_prompt_viewed", userId: customer.userId, surface: "likes_you", now: T0 }, { db });
    await recordPlusEvent({ event: "plus_prompt_clicked", userId: customer.userId, surface: "likes_you", now: T0 }, { db });
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    await recordPlusEvent({ event: "plus_checkout_started", userId: customer.userId, surface: "likes_you", orderId: order.id, eventKey: `checkout:${order.id}`, now: T0 }, { db });
    await recordPlusEvent({ event: "plus_receipt_uploaded", userId: customer.userId, orderId: order.id, eventKey: `receipt:${order.id}`, now: T0 }, { db });
    await submitReceipt(customer, order.id, await receipt(), { db, storage, now: T0 });
    await approveOrder(admin, order.id, { db, now: at(T0, hours(1)) });

    const report = await getPlusFunnelReport(hours(24), { db, now: T0 });
    if (!report.enabled) throw new Error("expected enabled");
    expect(report.rows).toEqual([{ surface: "likes_you", viewed: 2, clicked: 1, checkouts: 1, instructions: 0, receipts: 1, approved: 1 }]);
    expect(report.total).toMatchObject({ viewed: 2, clicked: 1, checkouts: 1, receipts: 1, approved: 1 });
  });

  it("shows a rate only next to the counts it came from", () => {
    expect(ratio(3, 10)).toBe("3 / 10 (30%)");
    expect(ratio(0, 0)).toBe("0");
    expect(ratio(2, 0)).toBe("2");
  });
});

// ───────────────────────────── Abandoned checkout reminder ─────────────────────────────

describe("checkout reminder", () => {
  // Thursday 09:00 UTC = 14:00 in the Maldives: inside the daytime window, after the hard floor.
  const ORDERED = new Date("2026-09-24T09:00:00Z");
  const DUE = at(ORDERED, hours(25));
  const on = (since = "2026-09-24T00:00:00Z") => {
    process.env.PLUS_CHECKOUT_REMINDERS = "on";
    process.env.PLUS_CHECKOUT_REMINDERS_SINCE = since;
  };
  const reminders = () => db.notification.findMany({ where: { type: "ACCOUNT_NOTICE" } });

  async function waitingOrder(now = ORDERED) {
    const { admin, customer, plan } = await shop();
    const order = await createOrder(customer, { planId: plan.id }, { db, now });
    return { admin, customer, plan, order };
  }

  afterEach(() => {
    delete process.env.PLUS_CHECKOUT_REMINDERS_SINCE;
  });

  it("does nothing at all while switched off — the shipped default", async () => {
    await waitingOrder();
    expect(await sweepCheckoutReminders({ db, now: DUE, force: true })).toEqual({ ran: false, reason: "off" });
    expect(await reminders()).toHaveLength(0);
  });

  it("does nothing when switched on without a cutoff", async () => {
    process.env.PLUS_CHECKOUT_REMINDERS = "on";
    await waitingOrder();
    expect(await sweepCheckoutReminders({ db, now: DUE, force: true })).toEqual({ ran: false, reason: "no-cutoff" });
    expect(await reminders()).toHaveLength(0);
  });

  it("never reminds an order from before the hard floor, whatever the configured cutoff says", async () => {
    on("2020-01-01T00:00:00Z");
    // Like the four awaiting orders that already exist in production.
    await waitingOrder(new Date("2026-09-21T06:00:00Z"));
    expect(reminderCutoff()).toEqual(CHECKOUT_REMINDER.notBefore);
    const result = await sweepCheckoutReminders({ db, now: new Date("2026-09-25T09:00:00Z"), force: true });
    expect(result).toEqual({ ran: true, created: 0, skipped: 0 });
    expect(await reminders()).toHaveLength(0);
  });

  it("never reminds an order from before the configured cutoff either", async () => {
    on("2026-09-24T12:00:00Z");
    await waitingOrder();
    expect((await sweepCheckoutReminders({ db, now: DUE, force: true })).ran).toBe(true);
    expect(await reminders()).toHaveLength(0);
  });

  it("sends ONE reminder for an eligible order, however many sweeps run, and changes nothing else", async () => {
    on();
    const { customer, order } = await waitingOrder();
    const before = await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } });

    expect(await sweepCheckoutReminders({ db, now: DUE, force: true })).toEqual({ ran: true, created: 1, skipped: 0 });
    for (const later of [at(DUE, minutes(10)), at(DUE, hours(2)), at(DUE, hours(26))]) {
      await sweepCheckoutReminders({ db, now: later, force: true });
    }
    const rows = await reminders();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: customer.userId, data: { kind: "CHECKOUT_REMINDER", orderId: order.id } });
    // The order itself is untouched.
    expect(await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } })).toEqual(before);

    const feed = await getNotificationFeed(customer, {}, { db, now: DUE });
    expect(feed.items[0]).toMatchObject({
      title: "Still interested in MelloCrush Plus?",
      detail: "Your Plus order is waiting for payment.",
      href: `/settings/membership/order/${order.id}?from=checkout_recovery`,
    });
  });

  it("racing sweeps still create one reminder", async () => {
    on();
    const { customer, order } = await waitingOrder();
    const cutoff = reminderCutoff()!;
    await Promise.all([1, 2, 3, 4].map(() => remindOrder(db, { orderId: order.id, userId: customer.userId }, DUE, cutoff)));
    expect(await reminders()).toHaveLength(1);
  });

  it("waits a day before reminding", async () => {
    on();
    await waitingOrder();
    await sweepCheckoutReminders({ db, now: at(ORDERED, hours(23)), force: true });
    expect(await reminders()).toHaveLength(0);
  });

  it("skips an order with a receipt attached", async () => {
    on();
    const { customer, order } = await waitingOrder();
    await db.subscriptionOrder.update({ where: { id: order.id }, data: { receiptKey: "test/receipt.jpg" } });
    await sweepCheckoutReminders({ db, now: DUE, force: true });
    expect(await reminders()).toHaveLength(0);
    expect(customer).toBeTruthy();
  });

  it("skips a cancelled order and an order superseded by a newer one", async () => {
    on();
    const { customer, order, admin } = await waitingOrder();
    await cancelOrder(customer, order.id, { db, now: at(ORDERED, hours(1)) });
    const plan2 = await createPlan(admin, { code: "QUARTER", name: "3 months", intervalDays: 90, priceMinor: 39_900, currency: "MVR", active: true, isPlaceholderPrice: false, sortOrder: 2 }, { db, now: ORDERED });
    // The newer order is too young to remind, and the old one is cancelled: nothing goes.
    await createOrder(customer, { planId: plan2.id }, { db, now: at(DUE, -hours(2)) });
    await sweepCheckoutReminders({ db, now: DUE, force: true });
    expect(await reminders()).toHaveLength(0);
  });

  it("skips a member who already has Plus", async () => {
    on();
    const { customer } = await waitingOrder();
    await grantPlus(db, customer.userId, at(ORDERED, hours(1)), at(DUE, hours(24 * 30)));
    await sweepCheckoutReminders({ db, now: DUE, force: true });
    expect(await reminders()).toHaveLength(0);
  });

  it("never runs at night in the Maldives", async () => {
    on();
    await waitingOrder();
    // 20:30 UTC = 01:30 in the Maldives.
    expect(await sweepCheckoutReminders({ db, now: new Date("2026-09-25T20:30:00Z"), force: true })).toEqual({ ran: false, reason: "outside-hours" });
    expect(await reminders()).toHaveLength(0);
  });

  it("reminds a member at most once in 30 days, even about a later order", async () => {
    on();
    const { customer, order, admin } = await waitingOrder();
    await sweepCheckoutReminders({ db, now: DUE, force: true });
    await cancelOrder(customer, order.id, { db, now: at(DUE, hours(1)) });
    const plan2 = await createPlan(admin, { code: "QUARTER", name: "3 months", intervalDays: 90, priceMinor: 39_900, currency: "MVR", active: true, isPlaceholderPrice: false, sortOrder: 2 }, { db, now: ORDERED });
    await createOrder(customer, { planId: plan2.id }, { db, now: at(DUE, hours(2)) });
    await sweepCheckoutReminders({ db, now: at(DUE, hours(28)), force: true });
    expect(await reminders()).toHaveLength(1);
  });

  it("sends no email", async () => {
    on();
    const { customer } = await waitingOrder();
    await createIdentity(db, customer.userId);
    resetEmailProviderCache();
    await sweepCheckoutReminders({ db, now: DUE, force: true });
    expect((getEmailProvider() as ConsoleEmailProvider).sent).toHaveLength(0);
  });
});

// ───────────────────────────── Discover (Option A) and Undo ─────────────────────────────

describe("Discover Likes You prompt (Option A)", () => {
  it("is not sent while PLUS_DISCOVER_PROMPT is off", async () => {
    const me = await createUser(db, { now: T0 });
    await likedBy(me, 2);
    expect((await getDeck(me, {}, { db, storage, now: T0 })).likesTeaser).toBeNull();
  });

  it("carries the real eligible count for a Free member with likes", async () => {
    process.env.PLUS_DISCOVER_PROMPT = "on";
    const me = await createUser(db, { now: T0 });
    const [, passed] = await likedBy(me, 3);
    await passUser(me, passed!.userId, { db, now: at(T0, minutes(1)) });
    expect((await getDeck(me, {}, { db, storage, now: at(T0, minutes(2)) })).likesTeaser).toEqual({ count: 2 });
  });

  it("says nothing when nobody likes the member", async () => {
    process.env.PLUS_DISCOVER_PROMPT = "on";
    const me = await createUser(db, { now: T0 });
    expect((await getDeck(me, {}, { db, storage, now: T0 })).likesTeaser).toBeNull();
  });

  it("is never sent to a Plus member", async () => {
    process.env.PLUS_DISCOVER_PROMPT = "on";
    const me = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await likedBy(me, 2);
    expect((await getDeck(me, {}, { db, storage, now: T0 })).likesTeaser).toBeNull();
  });
});

describe("Undo button exposure", () => {
  it("Free members see no Undo while PLUS_UNDO_UI is off (unchanged behaviour)", async () => {
    const me = await createUser(db, { now: T0 });
    expect((await getDeck(me, {}, { db, storage, now: T0 })).capabilities).toMatchObject({ canUndo: false, showUndo: false });
  });

  it("with PLUS_UNDO_UI on, Free members see Undo but the server still refuses it and changes nothing", async () => {
    process.env.PLUS_UNDO_UI = "on";
    const me = await createUser(db, { now: T0 });
    const other = await createUser(db, { now: T0 });
    expect((await getDeck(me, {}, { db, storage, now: T0 })).capabilities).toMatchObject({ canUndo: false, showUndo: true });
    await passUser(me, other.userId, { db, now: T0 });
    const before = await db.pass.findMany({ where: { fromUserId: me.userId } });
    await expect(undoAndRestore(me, { db, storage, now: at(T0, minutes(1)) })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect(await db.pass.findMany({ where: { fromUserId: me.userId } })).toEqual(before);
  });

  it("Plus members keep Undo whatever the switch says, with the existing server behaviour", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const other = await createUser(db, { now: T0 });
    expect((await getDeck(me, {}, { db, storage, now: T0 })).capabilities).toMatchObject({ canUndo: true, showUndo: true });
    await passUser(me, other.userId, { db, now: T0 });
    const restored = await undoAndRestore(me, { db, storage, now: at(T0, minutes(1)) });
    expect(restored.card?.handle).toBe(other.handle);
  });

  it("Undo never restores somebody the member has since blocked", async () => {
    const me = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const other = await createUser(db, { now: T0 });
    await passUser(me, other.userId, { db, now: T0 });
    await blockUser(other, me.userId, { db, now: at(T0, minutes(1)) });
    expect((await undoAndRestore(me, { db, storage, now: at(T0, minutes(2)) })).card).toBeNull();
  });
});

// ───────────────────────────── Notification read semantics ─────────────────────────────

describe("viewing Likes You marks like notifications read", () => {
  it("marks only this member's LIKE_RECEIVED rows up to the page's render time, and nothing else", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const likers = await likedBy(me, 2);
    // A match (NEW_MATCH for me) and another member's like notification, neither of which may be touched.
    const mutual = await createUser(db, { now: T0 });
    await likeUser(me, mutual.userId, { db, now: T0 });
    await likeUser(mutual, me.userId, { db, now: T0 });
    const other = await createUser(db, { now: T0 });
    await likeUser(likers[0]!, other.userId, { db, now: T0 });

    const seenAt = at(T0, minutes(5));
    // A like landing after the page rendered stays unread.
    const late = await createUser(db, { now: T0 });
    await likeUser(late, me.userId, { db, now: at(T0, minutes(6)) });
    const likeRowsBefore = await db.like.findMany({ orderBy: { id: "asc" } });
    const countBefore = (await getLikesYou(me, { db, now: at(T0, minutes(7)) })).count;
    const badgesBefore = await getNavBadges(me, { db });

    const result = await markLikesSeen(me, { seenAt }, { db, now: at(T0, minutes(7)) });
    expect(result.marked).toBe(2);

    const mine = await db.notification.findMany({ where: { userId: me.userId } });
    const likeRows = mine.filter((n) => n.type === "LIKE_RECEIVED");
    expect(likeRows.filter((n) => n.readAt !== null).map((n) => n.actorId).sort()).toEqual(likers.map((l) => l.userId).sort());
    expect(likeRows.find((n) => n.actorId === late.userId)?.readAt).toBeNull();
    expect(mine.filter((n) => n.type !== "LIKE_RECEIVED").every((n) => n.readAt === null)).toBe(true);
    expect((await db.notification.findFirstOrThrow({ where: { userId: other.userId } })).readAt).toBeNull();

    // The likes, and what Likes You shows, are unchanged.
    expect(await db.like.findMany({ orderBy: { id: "asc" } })).toEqual(likeRowsBefore);
    expect((await getLikesYou(me, { db, now: at(T0, minutes(7)) })).count).toBe(countBefore);
    // The Likes badge drops by exactly the two rows now read.
    expect((await getNavBadges(me, { db })).likes).toBe(badgesBefore.likes - 2);
    expect(result.unread).toBe(await db.notification.count({ where: { userId: me.userId, readAt: null } }));
  });

  it("cannot mark ahead of the server's clock", async () => {
    const me = await createUser(db, { now: T0 });
    const late = await createUser(db, { now: T0 });
    await likeUser(late, me.userId, { db, now: at(T0, hours(2)) });
    await markLikesSeen(me, { seenAt: at(T0, hours(10)) }, { db, now: at(T0, hours(1)) });
    expect((await db.notification.findFirstOrThrow({ where: { userId: me.userId, type: "LIKE_RECEIVED" } })).readAt).toBeNull();
  });
});

describe("opening a match's chat marks that match's notification read", () => {
  it("clears only this conversation's NEW_MATCH, leaves other matches and the match itself alone", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const convs: string[] = [];
    for (const other of [a, b]) {
      await likeUser(me, other.userId, { db, now: T0 });
      const r = await likeUser(other, me.userId, { db, now: T0 });
      convs.push(r.conversationId!);
    }
    const matchesBefore = await db.match.findMany({ orderBy: { id: "asc" } });

    const result = await markConversationRead(me, convs[0]!, { db, now: at(T0, minutes(1)) });
    expect(result.unreadCleared).toBe(true);

    const rows = await db.notification.findMany({ where: { userId: me.userId, type: "NEW_MATCH" } });
    expect(rows.find((n) => n.conversationId === convs[0])?.readAt).not.toBeNull();
    expect(rows.find((n) => n.conversationId === convs[1])?.readAt).toBeNull();
    // The other member's NEW_MATCH for the same conversation is theirs to read.
    expect((await db.notification.findFirstOrThrow({ where: { userId: a.userId, type: "NEW_MATCH" } })).readAt).toBeNull();
    expect(await db.match.findMany({ orderBy: { id: "asc" } })).toEqual(matchesBefore);
  });

  it("stops the match-email sweep mailing about a chat already opened", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const other = await createUser(db, { now: T0 });
    await createIdentity(db, me.userId);
    await likeUser(me, other.userId, { db, now: T0 });
    const r = await likeUser(other, me.userId, { db, now: T0 });
    await markConversationRead(me, r.conversationId!, { db, now: at(T0, minutes(1)) });
    const later = at(T0, hours(2));
    await db.user.update({ where: { id: me.userId }, data: { lastActiveAt: at(T0, minutes(1)) } });
    resetEmailProviderCache();
    await sweepMatchEmails({ db, now: later, force: true });
    expect((getEmailProvider() as ConsoleEmailProvider).sent.filter((m) => m.to.startsWith("user"))).toHaveLength(0);
  });
});

// ───────────────────────────── Funnel retention ─────────────────────────────

describe("Plus funnel retention", () => {
  it("keeps an event just inside 90 days, removes an older one, touches nothing else, and is idempotent", async () => {
    const { customer, plan } = await shop();
    const order = await createOrder(customer, { planId: plan.id }, { db, now: T0 });
    const now = at(T0, hours(24 * 120));
    const day = 86_400_000;
    await db.plusFunnelEvent.create({ data: { eventKey: "inside", userId: customer.userId, event: "plus_prompt_viewed", surface: "likes_you", createdAt: new Date(now.getTime() - 90 * day + minutes(1)) } });
    await db.plusFunnelEvent.create({ data: { eventKey: "outside", userId: customer.userId, event: "plus_checkout_started", surface: "likes_you", orderId: order.id, createdAt: new Date(now.getTime() - 90 * day - minutes(1)) } });
    const orderBefore = await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } });

    const first = await purgeExpiredAnalytics({ db, now });
    expect(first.plusFunnelEvents).toBe(1);
    expect((await db.plusFunnelEvent.findMany()).map((e) => e.eventKey)).toEqual(["inside"]);
    expect(await db.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } })).toEqual(orderBefore);

    expect((await purgeExpiredAnalytics({ db, now })).plusFunnelEvents).toBe(0);
    expect(await db.plusFunnelEvent.count()).toBe(1);
  });
});

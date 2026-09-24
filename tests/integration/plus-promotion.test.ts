import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { ratio } from "@/components/features/admin/plus-funnel-panel";
import type { AdminActor } from "@/server/admin/authz";
import { getPlusFunnelReport, parsePlusPromptBody, recordPlusEvent } from "@/server/analytics/plus-funnel";
import { approveOrder } from "@/server/billing/approval";
import { createOrder, submitReceipt } from "@/server/billing/orders";
import { createPaymentMethod } from "@/server/billing/payment-methods";
import { createPlan } from "@/server/billing/plans";
import { setOcrEngine, textEngine } from "@/server/ocr/engine";
import { likeUser, passUser } from "@/server/likes/like";
import { getLikesTeaser, getLikesYou } from "@/server/likes/likes-you";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

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

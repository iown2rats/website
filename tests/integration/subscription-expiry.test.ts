/**
 * The subscription lifecycle sweep (docs/ARCHITECTURE.md §12.12), and the thing it is NOT responsible for.
 *
 * Plus is decided by the clock, not by this sweep: `getEntitlements` and `activePlusSql` both require
 * `currentPeriodEnd > now`, so a lapsed period stops granting at the instant it ends whether or not anything has
 * run. Every case below asserts the entitlement independently of the sweep's bookkeeping, because that separation
 * is the property that makes a missed cron run a reporting problem rather than a paid-features leak — and a
 * regression in it would be invisible in the sweep's own return value.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getEntitlements } from "@/server/entitlements";
import { markExpiredSubscriptions, notifyExpiringSubscriptions } from "@/server/billing/expiry";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createSubscription, createUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-21T00:00:00Z");
const days = (n: number) => n * 24 * 3_600_000;

const tierAt = async (userId: string, now: Date) => (await getEntitlements(db, userId, now)).tier;
const statusOf = async (id: string) => (await db.subscription.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("1 — an active subscription before its end date", () => {
  it("is left alone, and the customer keeps Plus", async () => {
    const u = await createUser(db, { now: T0 });
    const sub = await createSubscription(db, u.userId, { periodStart: T0, periodEnd: at(T0, days(30)) });

    expect(await tierAt(u.userId, at(T0, days(10)))).toBe("PLUS");
    const r = await markExpiredSubscriptions(db, at(T0, days(10)));
    expect(r).toEqual({ expired: 0, notified: 0 });
    expect(await statusOf(sub.id)).toBe("ACTIVE");
    expect(await tierAt(u.userId, at(T0, days(10)))).toBe("PLUS");
  });
});

describe("2 — an active subscription after its end date", () => {
  it("is marked EXPIRED and the customer is told once", async () => {
    const u = await createUser(db, { now: T0 });
    const sub = await createSubscription(db, u.userId, { periodStart: T0, periodEnd: at(T0, days(30)) });

    // Plus is already gone a moment after the period ends, before anything has swept.
    expect(await tierAt(u.userId, at(T0, days(30) + 1))).toBe("FREE");
    expect(await statusOf(sub.id)).toBe("ACTIVE");

    const r = await markExpiredSubscriptions(db, at(T0, days(31)));
    expect(r).toEqual({ expired: 1, notified: 1 });
    expect(await statusOf(sub.id)).toBe("EXPIRED");
    expect(await tierAt(u.userId, at(T0, days(31)))).toBe("FREE");
  });
});

describe("3 — the exact boundary", () => {
  it("treats currentPeriodEnd as exclusive: Plus ends the instant the period does", async () => {
    const u = await createUser(db, { now: T0 });
    const end = at(T0, days(30));
    const sub = await createSubscription(db, u.userId, { periodStart: T0, periodEnd: end });

    // One millisecond before: still Plus, still untouched.
    expect(await tierAt(u.userId, new Date(end.getTime() - 1))).toBe("PLUS");
    expect(await markExpiredSubscriptions(db, new Date(end.getTime() - 1))).toEqual({ expired: 0, notified: 0 });
    expect(await statusOf(sub.id)).toBe("ACTIVE");

    // Exactly at the boundary: the entitlement is FREE (`gt`), and the sweep claims it (`lte`). The two
    // comparisons are deliberately complementary — if both used the same one, the boundary instant would either
    // grant Plus on an expired row or expire a row that was still granting.
    expect(await tierAt(u.userId, end)).toBe("FREE");
    expect(await markExpiredSubscriptions(db, end)).toEqual({ expired: 1, notified: 1 });
    expect(await statusOf(sub.id)).toBe("EXPIRED");
  });
});

describe("4 — a subscription that is already EXPIRED", () => {
  it("is not picked up again and produces no second notification", async () => {
    const u = await createUser(db, { now: T0 });
    await createSubscription(db, u.userId, { status: "EXPIRED", periodStart: at(T0, -days(60)), periodEnd: at(T0, -days(30)) });

    expect(await markExpiredSubscriptions(db, T0)).toEqual({ expired: 0, notified: 0 });
    expect(await db.notification.count({ where: { userId: u.userId, type: "SUBSCRIPTION_EXPIRED" } })).toBe(0);
    expect(await tierAt(u.userId, T0)).toBe("FREE");
  });
});

describe("5 — running the sweep repeatedly", () => {
  it("is idempotent: the second and third runs change nothing", async () => {
    const u = await createUser(db, { now: T0 });
    await createSubscription(db, u.userId, { periodStart: T0, periodEnd: at(T0, days(30)) });
    const after = at(T0, days(31));

    expect(await markExpiredSubscriptions(db, after)).toEqual({ expired: 1, notified: 1 });
    expect(await markExpiredSubscriptions(db, after)).toEqual({ expired: 0, notified: 0 });
    expect(await markExpiredSubscriptions(db, at(after, days(1)))).toEqual({ expired: 0, notified: 0 });
    expect(await db.notification.count({ where: { userId: u.userId, type: "SUBSCRIPTION_EXPIRED" } })).toBe(1);
  });

  it("warns only once however many times it runs", async () => {
    const u = await createUser(db, { now: T0 });
    await createSubscription(db, u.userId, { periodStart: at(T0, -days(28)), periodEnd: at(T0, days(2)) });

    expect(await notifyExpiringSubscriptions(db, T0)).toBe(1);
    expect(await notifyExpiringSubscriptions(db, T0)).toBe(0);
    expect(await notifyExpiringSubscriptions(db, at(T0, days(1)))).toBe(0);
    expect(await db.notification.count({ where: { userId: u.userId, type: "SUBSCRIPTION_EXPIRING" } })).toBe(1);
  });
});

describe("6 — a customer who renewed", () => {
  it("keeps Plus when the old period lapses, and is not told their Plus ended", async () => {
    const u = await createUser(db, { now: T0 });
    const old = await createSubscription(db, u.userId, { periodStart: at(T0, -days(30)), periodEnd: at(T0, days(1)) });
    const renewed = await createSubscription(db, u.userId, { periodStart: at(T0, days(1)), periodEnd: at(T0, days(31)) });

    const afterOldEnds = at(T0, days(2));
    // The old row is genuinely expired and is recorded as such...
    expect(await markExpiredSubscriptions(db, afterOldEnds)).toEqual({ expired: 1, notified: 0 });
    expect(await statusOf(old.id)).toBe("EXPIRED");
    // ...the renewal is untouched, and the customer never loses Plus for a moment.
    expect(await statusOf(renewed.id)).toBe("ACTIVE");
    expect(await tierAt(u.userId, afterOldEnds)).toBe("PLUS");
    // The "your Plus has ended" notification would be a lie, so it is not sent.
    expect(await db.notification.count({ where: { userId: u.userId, type: "SUBSCRIPTION_EXPIRED" } })).toBe(0);
  });

  it("does not warn about a period that a later one already covers", async () => {
    const u = await createUser(db, { now: T0 });
    await createSubscription(db, u.userId, { periodStart: at(T0, -days(28)), periodEnd: at(T0, days(2)) });
    await createSubscription(db, u.userId, { periodStart: at(T0, days(2)), periodEnd: at(T0, days(32)) });

    // Only the LAST paid period is worth warning about; the customer is not about to lose anything.
    expect(await notifyExpiringSubscriptions(db, T0)).toBe(0);
  });
});

describe("7 — several subscriptions on one account", () => {
  it("expires every lapsed row, leaves valid ones, and sends exactly one notification", async () => {
    const u = await createUser(db, { now: T0 });
    const first = await createSubscription(db, u.userId, { periodStart: at(T0, -days(90)), periodEnd: at(T0, -days(60)) });
    const second = await createSubscription(db, u.userId, { periodStart: at(T0, -days(60)), periodEnd: at(T0, -days(30)) });
    const third = await createSubscription(db, u.userId, { periodStart: at(T0, -days(30)), periodEnd: at(T0, days(5)) });

    const r = await markExpiredSubscriptions(db, T0);
    expect(r.expired).toBe(2);
    // Two rows lapsed, but the customer still has Plus, so neither triggers a "your Plus has ended" message.
    expect(r.notified).toBe(0);
    expect(await statusOf(first.id)).toBe("EXPIRED");
    expect(await statusOf(second.id)).toBe("EXPIRED");
    expect(await statusOf(third.id)).toBe("ACTIVE");
    expect(await tierAt(u.userId, T0)).toBe("PLUS");

    // Once the last one lapses too, they are told once.
    const afterTheLastOne = at(T0, days(6));
    expect(await markExpiredSubscriptions(db, afterTheLastOne)).toEqual({ expired: 1, notified: 1 });
    expect(await tierAt(u.userId, afterTheLastOne)).toBe("FREE");
    expect(await db.notification.count({ where: { userId: u.userId, type: "SUBSCRIPTION_EXPIRED" } })).toBe(1);
  });

  it("never touches another customer's subscription", async () => {
    const lapsing = await createUser(db, { now: T0 });
    const safe = await createUser(db, { now: T0 });
    await createSubscription(db, lapsing.userId, { periodStart: at(T0, -days(30)), periodEnd: at(T0, -1) });
    const other = await createSubscription(db, safe.userId, { periodStart: T0, periodEnd: at(T0, days(30)) });

    expect(await markExpiredSubscriptions(db, T0)).toEqual({ expired: 1, notified: 1 });
    expect(await statusOf(other.id)).toBe("ACTIVE");
    expect(await tierAt(safe.userId, T0)).toBe("PLUS");
    expect(await db.notification.count({ where: { userId: safe.userId } })).toBe(0);
  });
});

describe("an admin grant is a separate source of Plus", () => {
  it("survives the sweep, because the sweep only ever touches subscriptions", async () => {
    const u = await createUser(db, { now: T0 });
    await createSubscription(db, u.userId, { periodStart: at(T0, -days(30)), periodEnd: at(T0, -1) });
    await db.entitlementOverride.create({ data: { userId: u.userId, tier: "PLUS", reason: "goodwill", startsAt: at(T0, -days(1)), endsAt: at(T0, days(10)) } });

    expect(await markExpiredSubscriptions(db, T0)).toEqual({ expired: 1, notified: 1 });
    // The subscription lapsed, but the grant still stands, so Plus does too.
    expect(await tierAt(u.userId, T0)).toBe("PLUS");
    const e = await getEntitlements(db, u.userId, T0);
    expect(e.overridden).toBe(true);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PRODUCT_RULES, USAGE_WINDOWS } from "@/config/product";
import { LikeLimitReachedError } from "@/lib/errors";
import { getLikeAllowance } from "@/server/entitlements";
import { likeUser, passUser } from "@/server/likes/like";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createSubscription, createUser, grantPlus, hours, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");

async function targets(n: number): Promise<TestUser[]> {
  const out: TestUser[] = [];
  for (let i = 0; i < n; i++) out.push(await createUser(db, { now: T0 }));
  return out;
}

async function likeAll(actor: TestUser, list: TestUser[], now: Date) {
  for (const t of list) await likeUser(actor, t.userId, { db, now });
}

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("Free like allowance (30 per rolling 24 hours)", () => {
  it("starts with the full allowance and no open window", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await getLikeAllowance(db, me.userId, T0);
    expect(a).toMatchObject({ limit: 30, used: 0, remaining: 30, resetsAt: null, tier: "FREE" });
  });

  it("a like consumes one, a pass consumes nothing", async () => {
    const me = await createUser(db, { now: T0 });
    const [a, b] = await targets(2);
    await likeUser(me, a!.userId, { db, now: T0 });
    await passUser(me, b!.userId, { db, now: T0 });
    const allowance = await getLikeAllowance(db, me.userId, T0);
    expect(allowance.used).toBe(1);
    expect(allowance.remaining).toBe(29);
    expect(allowance.resetsAt?.getTime()).toBe(at(T0, hours(24)).getTime());
  });

  it("the 30th like succeeds and the 31st is rejected with the window reset time", async () => {
    const me = await createUser(db, { now: T0 });
    const list = await targets(31);
    await likeAll(me, list.slice(0, 29), T0);
    const thirtieth = await likeUser(me, list[29]!.userId, { db, now: at(T0, hours(1)) });
    expect(thirtieth.created).toBe(true);
    expect(thirtieth.likesRemaining).toBe(0);

    const err = await likeUser(me, list[30]!.userId, { db, now: at(T0, hours(2)) }).catch((e) => e);
    expect(err).toBeInstanceOf(LikeLimitReachedError);
    expect((err as LikeLimitReachedError).limit).toBe(30);
    expect((err as LikeLimitReachedError).resetsAt.getTime()).toBe(at(T0, hours(24)).getTime());
    expect(await db.like.count({ where: { fromUserId: me.userId } })).toBe(30);
  });

  it("the allowance becomes available again once the 24-hour window has ended", async () => {
    const me = await createUser(db, { now: T0 });
    const list = await targets(31);
    await likeAll(me, list.slice(0, 30), T0);
    await expect(likeUser(me, list[30]!.userId, { db, now: at(T0, hours(23)) })).rejects.toBeInstanceOf(LikeLimitReachedError);
    const after = await likeUser(me, list[30]!.userId, { db, now: at(T0, hours(24)) });
    expect(after.created).toBe(true);
    const allowance = await getLikeAllowance(db, me.userId, at(T0, hours(24)));
    expect(allowance.used).toBe(1);
    expect(allowance.resetsAt?.getTime()).toBe(at(T0, hours(48)).getTime());
  });

  it("re-liking the same person is idempotent and does not consume", async () => {
    const me = await createUser(db, { now: T0 });
    const [a] = await targets(1);
    const first = await likeUser(me, a!.userId, { db, now: T0 });
    const second = await likeUser(me, a!.userId, { db, now: at(T0, 1000) });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect((await getLikeAllowance(db, me.userId, T0)).used).toBe(1);
  });

  it("is not reset by anything client-side: the counter lives on the user row (new session, new client)", async () => {
    const me = await createUser(db, { now: T0 });
    const list = await targets(31);
    await likeAll(me, list.slice(0, 30), T0);
    // A fresh session/device/client is just another connection to the same server state.
    await db.session.create({
      data: { userId: me.userId, tokenHash: new Uint8Array(32).fill(7), expiresAt: at(T0, hours(1)), absoluteExpiresAt: at(T0, hours(2)) },
    });
    await expect(likeUser({ userId: me.userId }, list[30]!.userId, { db, now: at(T0, hours(5)) })).rejects.toBeInstanceOf(
      LikeLimitReachedError,
    );
  });

  it("concurrent requests with one like remaining yield exactly one success", async () => {
    const me = await createUser(db, { now: T0 });
    const list = await targets(35);
    await likeAll(me, list.slice(0, 29), T0);
    const contenders = list.slice(29, 35);
    const results = await Promise.allSettled(contenders.map((t) => likeUser(me, t.userId, { db, now: at(T0, hours(1)) })));
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(LikeLimitReachedError);
    expect(await db.like.count({ where: { fromUserId: me.userId } })).toBe(30);
    const counter = await db.usageCounter.findUniqueOrThrow({ where: { userId_kind: { userId: me.userId, kind: "LIKES" } } });
    expect(counter.used).toBe(30);
  });
});

describe("Plus like allowance (90 per rolling 24 hours)", () => {
  it("Plus receives 90; the 90th succeeds and the 91st fails", async () => {
    const me = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24 * 30)));
    expect((await getLikeAllowance(db, me.userId, T0)).limit).toBe(PRODUCT_RULES.PLUS.dailyLikeLimit);
    const list = await targets(91);
    await likeAll(me, list.slice(0, 89), T0);
    const ninetieth = await likeUser(me, list[89]!.userId, { db, now: T0 });
    expect(ninetieth.likesRemaining).toBe(0);
    await expect(likeUser(me, list[90]!.userId, { db, now: T0 })).rejects.toBeInstanceOf(LikeLimitReachedError);
  });

  it("subscription expiry returns the user to the Free limit within the same window", async () => {
    const me = await createUser(db, { now: T0 });
    await createSubscription(db, me.userId, { status: "ACTIVE", periodStart: at(T0, -hours(24 * 29)), periodEnd: at(T0, hours(2)) });
    const list = await targets(32);
    // 31 likes while Plus (limit 90): fine.
    await likeAll(me, list.slice(0, 31), T0);
    // Subscription has now ended; Free limit 30 applies and 31 are already used.
    const later = at(T0, hours(3));
    expect((await getLikeAllowance(db, me.userId, later)).tier).toBe("FREE");
    await expect(likeUser(me, list[31]!.userId, { db, now: later })).rejects.toBeInstanceOf(LikeLimitReachedError);
    // After the window rolls over they get the Free 30 again.
    const next = await likeUser(me, list[31]!.userId, { db, now: at(T0, USAGE_WINDOWS.LIKES) });
    expect(next.created).toBe(true);
  });

  it("CANCELLED keeps Plus until the period ends, EXPIRED never grants", async () => {
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    await createSubscription(db, a.userId, { status: "CANCELLED", periodStart: at(T0, -hours(48)), periodEnd: at(T0, hours(48)) });
    await createSubscription(db, b.userId, { status: "EXPIRED", periodStart: at(T0, -hours(48)), periodEnd: at(T0, hours(48)) });
    expect((await getLikeAllowance(db, a.userId, T0)).tier).toBe("PLUS");
    expect((await getLikeAllowance(db, b.userId, T0)).tier).toBe("FREE");
  });
});

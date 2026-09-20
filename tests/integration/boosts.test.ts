import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BOOST, USAGE_WINDOWS } from "@/config/product";
import { BoostAlreadyActiveError, BoostLimitReachedError, EntitlementRequiredError } from "@/lib/errors";
import { activateBoost } from "@/server/boosts/boost";
import { getDeckCandidateIds } from "@/server/discovery/query";
import { getBoostAllowance } from "@/server/entitlements";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, grantPlus, hours } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("Profile Boosts", () => {
  it("Plus receives 2 boosts per 7-day window", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24 * 30)));
    const a = await getBoostAllowance(db, me.userId, T0);
    expect(a).toMatchObject({ limit: 2, used: 0, remaining: 2, resetsAt: null, windowMs: USAGE_WINDOWS.BOOSTS });
  });

  it("enforces the allowance window and one active boost at a time", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24 * 30)));
    const first = await activateBoost(me, { db, now: T0 });
    expect(first.endsAt.getTime()).toBe(T0.getTime() + BOOST.durationMs);
    expect(first.boostsRemaining).toBe(1);
    await expect(activateBoost(me, { db, now: at(T0, 60_000) })).rejects.toBeInstanceOf(BoostAlreadyActiveError);

    const afterFirst = at(T0, BOOST.durationMs + 1);
    const second = await activateBoost(me, { db, now: afterFirst });
    expect(second.boostsRemaining).toBe(0);

    const afterSecond = at(afterFirst, BOOST.durationMs + 1);
    const err = await activateBoost(me, { db, now: afterSecond }).catch((e) => e);
    expect(err).toBeInstanceOf(BoostLimitReachedError);
    expect((err as BoostLimitReachedError).resetsAt.getTime()).toBe(at(T0, USAGE_WINDOWS.BOOSTS).getTime());

    const nextWeek = at(T0, USAGE_WINDOWS.BOOSTS);
    const third = await activateBoost(me, { db, now: nextWeek });
    expect(third.boostsRemaining).toBe(1);
  });

  it("a Free user is rejected", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await expect(activateBoost(me, { db, now: T0 })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect(await db.boost.count()).toBe(0);
  });

  it("concurrent activations cannot exceed the allowance", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24 * 30)));
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => activateBoost(me, { db, now: T0 })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.boost.count({ where: { userId: me.userId } })).toBe(1);
  });

  it("a boosted profile ranks first in discovery while active", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0 });
    const plain = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const boosted = await createUser(db, { now: T0 });
    await grantPlus(db, boosted.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await activateBoost(boosted, { db, now: T0 });
    const deck = await getDeckCandidateIds(db, viewer, { now: at(T0, 60_000) });
    expect(deck[0]).toBe(boosted.userId);
    expect(deck).toHaveLength(plain.length + 1);
    const later = await getDeckCandidateIds(db, viewer, { now: at(T0, BOOST.durationMs + 1) });
    expect(later).toHaveLength(plain.length + 1); // still present, just not pinned first
  });
});

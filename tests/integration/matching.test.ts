import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EntitlementRequiredError, NotFoundError, UndoUnavailableError } from "@/lib/errors";
import { getDeckCandidateIds } from "@/server/discovery/query";
import { likeUser, passUser, undoLastPass } from "@/server/likes/like";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createLocation, createUser, grantPlus, hours, minutes } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("Matching", () => {
  it("a one-sided like does not match; a mutual like creates one match, one conversation and two notifications", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const first = await likeUser(a, b.userId, { db, now: T0 });
    expect(first.matched).toBe(false);
    const second = await likeUser(b, a.userId, { db, now: at(T0, 1000) });
    expect(second.matched).toBe(true);
    expect(await db.match.count()).toBe(1);
    expect(await db.conversation.count()).toBe(1);
    expect(await db.notification.count({ where: { type: "NEW_MATCH" } })).toBe(2);
  });

  it("simultaneous mutual likes create exactly one match", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const results = await Promise.all([likeUser(a, b.userId, { db, now: T0 }), likeUser(b, a.userId, { db, now: T0 })]);
    expect(results.some((r) => r.matched)).toBe(true);
    expect(await db.match.count()).toBe(1);
    expect(await db.conversation.count()).toBe(1);
    expect(await db.notification.count({ where: { type: "NEW_MATCH" } })).toBe(2);
  });

  it("blocked users are excluded from discovery and cannot be liked", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await db.block.create({ data: { blockerId: b.userId, blockedId: a.userId } });
    expect(await getDeckCandidateIds(db, a, { now: T0 })).not.toContain(b.userId);
    expect(await getDeckCandidateIds(db, b, { now: T0 })).not.toContain(a.userId);
    await expect(likeUser(a, b.userId, { db, now: T0 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("passed profiles leave the deck; likes and passes respect preferences", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 24, ageMax: 30 });
    const woman27 = await createUser(db, { now: T0, gender: "WOMAN", age: 27 });
    const woman40 = await createUser(db, { now: T0, gender: "WOMAN", age: 40 });
    const man27 = await createUser(db, { now: T0, gender: "MAN", age: 27 });
    const womanWantsWomen = await createUser(db, { now: T0, gender: "WOMAN", age: 26, interestedIn: "WOMEN" });
    const deck = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(deck).toEqual([woman27.userId]);
    expect(deck).not.toContain(woman40.userId);
    expect(deck).not.toContain(man27.userId);
    expect(deck).not.toContain(womanWantsWomen.userId);
    await passUser(viewer, woman27.userId, { db, now: T0 });
    expect(await getDeckCandidateIds(db, viewer, { now: T0 })).toEqual([]);
  });

  it("location scopes filter by Greater Malé and atoll", async () => {
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const addu = await createLocation(db, { name: "Addu City", atollCode: "S" });
    const viewer = await createUser(db, { now: T0, locationId: male.id });
    const inMale = await createUser(db, { now: T0, locationId: male.id });
    const inAddu = await createUser(db, { now: T0, locationId: addu.id });
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { locationScope: "GREATER_MALE" } });
    expect(await getDeckCandidateIds(db, viewer, { now: T0 })).toEqual([inMale.userId]);
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { locationScope: "SPECIFIC", locationId: addu.id } });
    expect(await getDeckCandidateIds(db, viewer, { now: T0 })).toEqual([inAddu.userId]);
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { locationScope: "MY_ATOLL" } });
    expect(await getDeckCandidateIds(db, viewer, { now: T0 })).toEqual([inMale.userId]);
  });

  it("hidden or paused users are not discoverable", async () => {
    const viewer = await createUser(db, { now: T0 });
    const hidden = await createUser(db, { now: T0, visibility: "HIDDEN" });
    const paused = await createUser(db, { now: T0 });
    await db.privacySettings.update({ where: { userId: paused.userId }, data: { pausedAt: T0 } });
    const onboarding = await createUser(db, { now: T0, status: "ONBOARDING" });
    const deck = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(deck).not.toContain(hidden.userId);
    expect(deck).not.toContain(paused.userId);
    expect(deck).not.toContain(onboarding.userId);
  });
});

describe("Undo (Plus)", () => {
  it("is refused for Free users", async () => {
    const [a, b] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await passUser(a, b.userId, { db, now: T0 });
    await expect(undoLastPass(a, { db, now: at(T0, 1000) })).rejects.toBeInstanceOf(EntitlementRequiredError);
  });

  it("restores only the most recent pass, once, within the time window", async () => {
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const [b, c] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await passUser(a, b.userId, { db, now: T0 });
    await passUser(a, c.userId, { db, now: at(T0, minutes(1)) });
    expect(await getDeckCandidateIds(db, a, { now: at(T0, minutes(2)) })).toEqual([]);

    const undone = await undoLastPass(a, { db, now: at(T0, minutes(2)) });
    expect(undone.restoredUserId).toBe(c.userId);
    expect(await getDeckCandidateIds(db, a, { now: at(T0, minutes(3)) })).toEqual([c.userId]);

    // The older pass (b) can no longer be undone: only the most recent action, and it's been used.
    const second = await undoLastPass(a, { db, now: at(T0, minutes(3)) }).catch((e) => e);
    expect(second).toBeInstanceOf(UndoUnavailableError);
    const rows = await db.pass.findMany({ where: { fromUserId: a.userId }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.undoneAt === null)).toEqual([true, false]); // history retained
  });

  it("cannot undo once a later like exists, but has no time-based expiry", async () => {
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24 * 3)));
    const [b, c, d] = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    await passUser(a, b.userId, { db, now: T0 });
    await likeUser(a, c.userId, { db, now: at(T0, minutes(1)) });
    await expect(undoLastPass(a, { db, now: at(T0, minutes(2)) })).rejects.toBeInstanceOf(UndoUnavailableError);
    // A new pass is the latest action again; two days later it is still the eligible most-recent pass.
    await passUser(a, d.userId, { db, now: at(T0, minutes(3)) });
    const undone = await undoLastPass(a, { db, now: at(T0, minutes(3) + hours(48)) });
    expect(undone.restoredUserId).toBe(d.userId);
  });
});

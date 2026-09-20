import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { likeUser } from "@/server/likes/like";
import { getLikesYou } from "@/server/likes/likes-you";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, grantPlus, hours } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("Likes You", () => {
  it("a Free user gets the count and placeholders with no identifying fields", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const likers = [await createUser(db, { now: T0, name: "Hassan" }), await createUser(db, { now: T0, name: "Zara" })];
    for (const l of likers) await likeUser(l, me.userId, { db, now: T0 });

    const result = await getLikesYou(me, { db, now: T0 });
    expect(result.tier).toBe("FREE");
    expect(result.count).toBe(2);
    if (result.tier !== "FREE") throw new Error("unreachable");
    expect(result.placeholders).toHaveLength(2);
    for (const p of result.placeholders) {
      expect(Object.keys(p).sort()).toEqual(["blurhash", "verified"]);
      expect(p.blurhash).toMatch(/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]+$/);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Hassan");
    expect(serialized).not.toContain("Zara");
    for (const l of likers) {
      expect(serialized).not.toContain(l.userId);
      expect(serialized).not.toContain(l.handle);
      expect(serialized).not.toContain(l.phoneE164);
    }
    expect(serialized).not.toContain("test/"); // no storage keys
  });

  it("a Plus user gets the actual profiles", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const liker = await createUser(db, { now: T0, name: "Hassan" });
    await likeUser(liker, me.userId, { db, now: T0 });

    const result = await getLikesYou(me, { db, now: T0 });
    expect(result.tier).toBe("PLUS");
    if (result.tier !== "PLUS") throw new Error("unreachable");
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]!.name).toBe("Hassan");
    expect(result.profiles[0]!.handle).toBe(liker.handle);
    // Never present in any DTO:
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(liker.phoneE164);
    expect(serialized).not.toContain("dateOfBirth");
  });

  it("excludes blocked users and people already responded to", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const blocked = await createUser(db, { now: T0 });
    const matched = await createUser(db, { now: T0 });
    const fresh = await createUser(db, { now: T0 });
    for (const l of [blocked, matched, fresh]) await likeUser(l, me.userId, { db, now: T0 });
    await db.block.create({ data: { blockerId: me.userId, blockedId: blocked.userId } });
    await likeUser(me, matched.userId, { db, now: T0 });

    const result = await getLikesYou(me, { db, now: T0 });
    if (result.tier !== "PLUS") throw new Error("unreachable");
    expect(result.profiles.map((p) => p.userId)).toEqual([fresh.userId]);
  });

  it("honours hideAge and hideLocation in the Plus DTO", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const liker = await createUser(db, { now: T0, age: 31 });
    await db.privacySettings.update({ where: { userId: liker.userId }, data: { hideAge: true } });
    await likeUser(liker, me.userId, { db, now: T0 });
    const result = await getLikesYou(me, { db, now: T0 });
    if (result.tier !== "PLUS") throw new Error("unreachable");
    expect(result.profiles[0]!.age).toBeNull();
  });
});

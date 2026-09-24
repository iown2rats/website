import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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

beforeEach(() => resetDb(db));
afterEach(() => {
  for (const f of FLAGS) delete process.env[f];
});
afterAll(() => disconnectDb());

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

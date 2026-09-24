import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { likeUser } from "@/server/likes/like";
import { getLikesYou } from "@/server/likes/likes-you";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { createUser, type TestUser } from "../helpers/factory";

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

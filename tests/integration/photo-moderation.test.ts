/**
 * Profile-photo moderation (docs/ARCHITECTURE.md §6.1, §21.5): the admin queue, approve and reject, authorization,
 * the audit trail, the refusal of stale and double decisions, what production discovery does with each state, and
 * the empty-deck reason that must tell "waiting for moderation" apart from "you have seen everyone".
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { resetEnvCache } from "@/lib/env";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { AUDIT_ACTIONS } from "@/server/admin/audit";
import { AdminAccessError, hasPermission, type AdminActor } from "@/server/admin/authz";
import { countPendingPhotos, decidePhoto, listPendingPhotos } from "@/server/admin/photo-moderation";
import { getDeck } from "@/server/discovery/deck";
import { countAwaitingPhotoReview, countRelaxedCandidates, getDeckCandidateIds } from "@/server/discovery/query";
import { likeUser } from "@/server/likes/like";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, hours, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-18T09:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage-photo-moderation", "m".repeat(32));

async function makeAdmin(role: "ADMIN" | "MODERATOR" = "ADMIN"): Promise<AdminActor> {
  const u = await createUser(db, { now: T0 });
  await db.user.update({ where: { id: u.userId }, data: { role } });
  return { userId: u.userId, role };
}

/** Ids of a member's photos, in position order. */
async function photoIds(user: TestUser): Promise<string[]> {
  const rows = await db.profilePhoto.findMany({
    where: { profile: { userId: user.userId } },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

const moderationOf = async (photoId: string) =>
  (await db.profilePhoto.findUniqueOrThrow({ where: { id: photoId }, select: { moderation: true } })).moderation;

/** Run a body under the production photo policy, then restore the test default. */
async function underProductionPolicy<T>(body: () => Promise<T>): Promise<T> {
  process.env.PHOTO_VISIBILITY_POLICY = "approved-only";
  resetEnvCache();
  try {
    return await body();
  } finally {
    delete process.env.PHOTO_VISIBILITY_POLICY;
    resetEnvCache();
  }
}

beforeEach(() => resetDb(db));
afterEach(() => {
  delete process.env.PHOTO_VISIBILITY_POLICY;
  resetEnvCache();
});
afterAll(() => disconnectDb());

describe("authorization", () => {
  it("both roles may moderate photos and no other permission is granted by accident", () => {
    expect(hasPermission("ADMIN", "photos.moderate")).toBe(true);
    expect(hasPermission("MODERATOR", "photos.moderate")).toBe(true);
    expect(hasPermission("MODERATOR", "payments.review")).toBe(false);
  });

  it("refuses to list or decide for an actor without the permission, whatever the UI showed", async () => {
    const member = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const [photoId] = await photoIds(member);
    // A role object that does not carry the permission: the domain layer, not the page, is the gate.
    const notAllowed = { userId: (await createUser(db, { now: T0 })).userId, role: "MODERATOR" } as AdminActor;
    const stripped = { ...notAllowed, role: "NOBODY" as unknown as AdminActor["role"] };

    await expect(listPendingPhotos(stripped, { db, storage })).rejects.toBeInstanceOf(AdminAccessError);
    await expect(decidePhoto(stripped, photoId!, { decision: "APPROVED" }, { db, now: T0 })).rejects.toBeInstanceOf(AdminAccessError);
    expect(await moderationOf(photoId!)).toBe("PENDING");
    expect(await db.auditLog.count()).toBe(0);
  });

  it("nobody moderates their own photo", async () => {
    const admin = await makeAdmin();
    const own = await db.profilePhoto.findFirstOrThrow({ where: { profile: { userId: admin.userId } }, select: { id: true } });
    await db.profilePhoto.update({ where: { id: own.id }, data: { moderation: "PENDING" } });
    await expect(decidePhoto(admin, own.id, { decision: "APPROVED" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    expect(await moderationOf(own.id)).toBe("PENDING");
  });
});

describe("the queue", () => {
  it("lists only pending photos, newest upload first, with the member and the review context", async () => {
    const admin = await makeAdmin();
    const older = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const newer = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const settled = await createUser(db, { now: T0, photos: 2, photoModeration: "APPROVED" });
    const [olderFirst] = await photoIds(older);
    await db.profilePhoto.updateMany({ where: { profile: { userId: older.userId } }, data: { createdAt: at(T0, -hours(3)) } });
    await db.profilePhoto.updateMany({ where: { profile: { userId: newer.userId } }, data: { createdAt: at(T0, -hours(1)) } });

    const queue = await listPendingPhotos(admin, { db, storage });
    expect(queue.total).toBe(4);
    expect(queue.items.every((i) => i.moderation === "PENDING")).toBe(true);
    expect(queue.items.map((i) => i.userId).every((id) => id !== settled.userId)).toBe(true);
    // Newest first: the two photos uploaded an hour ago come before the pair from three hours ago.
    expect(queue.items.slice(0, 2).every((i) => i.userId === newer.userId)).toBe(true);
    expect(queue.items.slice(2).every((i) => i.userId === older.userId)).toBe(true);

    const row = queue.items.find((i) => i.photoId === olderFirst)!;
    expect(row).toMatchObject({ userId: older.userId, handle: older.handle, isPrimary: true, position: 0, accountStatus: "ACTIVE", approvedCount: 0, pendingCount: 2 });
    expect(row.uploadedAt).toBe(at(T0, -hours(3)).toISOString());
  });

  it("counts what is waiting for the navigation badge", async () => {
    await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    await createUser(db, { now: T0, photos: 2, photoModeration: "APPROVED" });
    expect(await countPendingPhotos(db)).toBe(2);
  });
});

describe("approving", () => {
  it("moves PENDING to APPROVED and records the actor, the action and the time", async () => {
    const admin = await makeAdmin("MODERATOR");
    const member = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const [first] = await photoIds(member);

    const r = await decidePhoto(admin, first!, { decision: "APPROVED" }, { db, now: T0 });
    expect(r).toEqual({ photoId: first, moderation: "APPROVED", userId: member.userId });
    expect(await moderationOf(first!)).toBe("APPROVED");

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.photoModerated } });
    expect(entry).toMatchObject({ actorId: admin.userId, targetType: "ProfilePhoto", targetId: first, createdAt: T0 });
    expect(entry.data).toMatchObject({ userId: member.userId, before: { moderation: "PENDING" }, after: { moderation: "APPROVED" }, reason: null });
  });

  it("leaves the member's other photos alone", async () => {
    const admin = await makeAdmin();
    const member = await createUser(db, { now: T0, photos: 3, photoModeration: "PENDING" });
    const ids = await photoIds(member);
    await decidePhoto(admin, ids[0]!, { decision: "APPROVED" }, { db, now: T0 });
    expect(await moderationOf(ids[1]!)).toBe("PENDING");
    expect(await moderationOf(ids[2]!)).toBe("PENDING");
  });
});

describe("rejecting", () => {
  it("moves PENDING to REJECTED with the reason in the audit log", async () => {
    const admin = await makeAdmin();
    const member = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const [first] = await photoIds(member);

    const r = await decidePhoto(admin, first!, { decision: "REJECTED", reason: "No face visible" }, { db, now: T0 });
    expect(r.moderation).toBe("REJECTED");
    expect(await moderationOf(first!)).toBe("REJECTED");
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.photoModerated } });
    expect(entry.data).toMatchObject({ reason: "No face visible", after: { moderation: "REJECTED" } });
  });

  it("insists on a reason, and writes nothing when it is missing", async () => {
    const admin = await makeAdmin();
    const member = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const [first] = await photoIds(member);
    await expect(decidePhoto(admin, first!, { decision: "REJECTED" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(decidePhoto(admin, first!, { decision: "REJECTED", reason: "no" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    expect(await moderationOf(first!)).toBe("PENDING");
    expect(await db.auditLog.count()).toBe(0);
  });

  it("refuses an unknown decision and an unknown photo", async () => {
    const admin = await makeAdmin();
    const member = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const [first] = await photoIds(member);
    await expect(decidePhoto(admin, first!, { decision: "PENDING" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(decidePhoto(admin, "does-not-exist", { decision: "APPROVED" }, { db, now: T0 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("stale and double decisions", () => {
  it("refuses a second decision on a photo somebody already approved", async () => {
    const one = await makeAdmin();
    const two = await makeAdmin();
    const member = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const [first] = await photoIds(member);

    await decidePhoto(one, first!, { decision: "APPROVED" }, { db, now: T0 });
    await expect(decidePhoto(two, first!, { decision: "REJECTED", reason: "Changed my mind" }, { db, now: at(T0, hours(1)) }))
      .rejects.toThrow(/already been approved/);
    expect(await moderationOf(first!)).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.photoModerated } })).toBe(1);
  });

  it("refuses a second decision on a photo somebody already rejected", async () => {
    const one = await makeAdmin();
    const two = await makeAdmin();
    const member = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const [first] = await photoIds(member);

    await decidePhoto(one, first!, { decision: "REJECTED", reason: "Not a photo of a person" }, { db, now: T0 });
    await expect(decidePhoto(two, first!, { decision: "APPROVED" }, { db, now: at(T0, hours(1)) })).rejects.toThrow(/already been rejected/);
    expect(await moderationOf(first!)).toBe("REJECTED");
  });

  it("only one of two simultaneous decisions wins, and exactly one audit row is written", async () => {
    const one = await makeAdmin();
    const two = await makeAdmin();
    const member = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const [first] = await photoIds(member);

    const results = await Promise.allSettled([
      decidePhoto(one, first!, { decision: "APPROVED" }, { db, now: T0 }),
      decidePhoto(two, first!, { decision: "REJECTED", reason: "Duplicate of another photo" }, { db, now: T0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.photoModerated } })).toBe(1);
    expect(["APPROVED", "REJECTED"]).toContain(await moderationOf(first!));
  });
});

describe("production discovery visibility", () => {
  it("shows a member only once enough of their photos are approved, and never a rejected one", async () => {
    const admin = await makeAdmin();
    const viewer = await createUser(db, { gender: "MAN", now: T0, age: 30, ageMin: 18, ageMax: 99 });
    const member = await createUser(db, { now: T0, photos: 3, photoModeration: "PENDING" });
    const ids = await photoIds(member);

    await underProductionPolicy(async () => {
      expect(await getDeckCandidateIds(db, viewer, { now: T0 })).not.toContain(member.userId);

      await decidePhoto(admin, ids[0]!, { decision: "APPROVED" }, { db, now: T0 });
      expect(await getDeckCandidateIds(db, viewer, { now: T0 })).not.toContain(member.userId); // one approved photo is not enough

      await decidePhoto(admin, ids[1]!, { decision: "REJECTED", reason: "Group photo" }, { db, now: T0 });
      expect(await getDeckCandidateIds(db, viewer, { now: T0 })).not.toContain(member.userId); // a rejection never counts towards the minimum

      await decidePhoto(admin, ids[2]!, { decision: "APPROVED" }, { db, now: T0 });
      expect(await getDeckCandidateIds(db, viewer, { now: T0 })).toContain(member.userId);

      const page = await getDeck(viewer, {}, { db, storage, now: T0 });
      const card = page.cards.find((c) => c.handle === member.handle)!;
      expect(card.photos).toHaveLength(2); // the rejected photo is not served with the card
    });
  });
});

describe("the empty-deck reason", () => {
  it("says people are being reviewed rather than claiming the viewer has seen everyone", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0, age: 30, ageMin: 18, ageMax: 99 });
    await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });

    await underProductionPolicy(async () => {
      expect(await countRelaxedCandidates(db, viewer, T0)).toBe(0);
      expect(await countAwaitingPhotoReview(db, viewer, T0)).toBe(1);
      const page = await getDeck(viewer, {}, { db, storage, now: T0 });
      expect(page.cards).toHaveLength(0);
      expect(page.emptyReason).toBe("REVIEW");
    });
  });

  it("says UNAVAILABLE (not \"seen everyone\") when there is genuinely nobody, and FILTERS when the viewer's own filters are the cause", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0, age: 30, ageMin: 18, ageMax: 99 });
    await underProductionPolicy(async () => {
      expect((await getDeck(viewer, {}, { db, storage, now: T0 })).emptyReason).toBe("UNAVAILABLE");
    });

    // Someone approved but outside the viewer's age range: that is the viewer's filter, not moderation.
    await createUser(db, { now: T0, age: 55, photos: 2, photoModeration: "APPROVED" });
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { ageMin: 18, ageMax: 35 } });
    await underProductionPolicy(async () => {
      const page = await getDeck(viewer, {}, { db, storage, now: T0 });
      expect(page.cards).toHaveLength(0);
      expect(page.emptyReason).toBe("FILTERS");
    });
  });

  it("prefers FILTERS over REVIEW, because only the filters are the viewer's to change", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0, age: 30, ageMin: 18, ageMax: 99 });
    await createUser(db, { now: T0, age: 55, photos: 2, photoModeration: "APPROVED" });
    await createUser(db, { now: T0, age: 30, photos: 2, photoModeration: "PENDING" });
    await db.discoveryPreferences.update({ where: { userId: viewer.userId }, data: { ageMin: 18, ageMax: 35 } });
    await underProductionPolicy(async () => {
      expect((await getDeck(viewer, {}, { db, storage, now: T0 })).emptyReason).toBe("FILTERS");
    });
  });

  it("does not count people the viewer has already acted on, or who are hidden from them", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0, age: 30, ageMin: 18, ageMax: 99 });
    const swiped = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    await likeUser(viewer, swiped.userId, { db, now: T0 });
    const paused = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    await db.privacySettings.update({ where: { userId: paused.userId }, data: { pausedAt: T0 } });

    await underProductionPolicy(async () => {
      expect(await countAwaitingPhotoReview(db, viewer, T0)).toBe(0);
      // Neither is shown (pending photos), so nobody compatible is here: not REVIEW, and not "seen everyone" either.
      expect((await getDeck(viewer, {}, { db, storage, now: T0 })).emptyReason).toBe("UNAVAILABLE");
    });
  });

  it("is never REVIEW under a policy where pending photos are already displayable", async () => {
    const viewer = await createUser(db, { gender: "MAN", now: T0, age: 30, ageMin: 18, ageMax: 99 });
    await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    // Test/development policy: a pending photo counts, so the member is simply in the deck.
    expect(await countAwaitingPhotoReview(db, viewer, T0)).toBe(0);
    const page = await getDeck(viewer, {}, { db, storage, now: T0 });
    expect(page.cards).toHaveLength(1);
    expect(page.emptyReason).toBe("NONE");
  });
});

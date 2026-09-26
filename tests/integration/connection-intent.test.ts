import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveConnectionIntent, saveGender, saveName } from "@/server/onboarding/onboarding";
import { getDiscoveryFilters, saveDiscoveryFilters } from "@/server/discovery/filters";
import { getDeckCandidateIds } from "@/server/discovery/query";
import { canDate } from "@/server/preferences/intent-policy";
import { updateInfo } from "@/server/profiles/edit";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { createLocation, createUser } from "../helpers/factory";

/*
 * Dating vs Friendship (docs/ARCHITECTURE.md §7.5).
 *
 * Two things are being protected here. The first is that nobody is asked who they want to see: the pool decides it
 * (Dating: opposite gender; Friendship: both), and nothing in a request can change it. The second is that the two
 * pools do not leak into each other, which is checked against the real deck query rather than against the policy
 * function, because the policy being right is no comfort if the SQL disagrees with it. The full matrix is in
 * tests/integration/discovery-pools.test.ts.
 */
const db = testDb();
const T0 = new Date("2026-09-20T12:00:00Z");

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

const prefs = (userId: string) => db.discoveryPreferences.findUniqueOrThrow({ where: { userId } });

/** A member part-way through onboarding, ready for the connection step. */
async function onboardingUser(gender: "WOMAN" | "MAN" | "UNSPECIFIED") {
  const user = await createUser(db, { now: T0, status: "ONBOARDING", gender });
  await db.discoveryPreferences.delete({ where: { userId: user.userId } });
  await saveName(user, { name: "Test" }, { db });
  await saveGender(user, { gender }, { db });
  return user;
}

const FILTERS = { ageMin: 22, ageMax: 34, locationScope: "ANYWHERE" as const, locationId: null, intent: null, heightMinCm: null, heightMaxCm: null, education: null };

describe("Dating asks nothing about who to meet", () => {
  for (const gender of ["MAN", "WOMAN"] as const) {
    it(`a ${gender} choosing Dating stores only the pool; the legacy Show me keeps its column default`, async () => {
      const user = await onboardingUser(gender);
      await saveConnectionIntent(user, { connectionIntent: "DATING" }, { db });
      const row = await prefs(user.userId);
      expect(row.connectionIntent).toBe("DATING");
      expect(row.interestedIn).toBe("EVERYONE");
      expect(row.friendshipInterestedIn).toBeNull();
    });
  }

  it("skips the 'who would you like to meet' step entirely", async () => {
    const user = await onboardingUser("MAN");
    await saveConnectionIntent(user, { connectionIntent: "DATING" }, { db });
    // The pointer lands on the relationship-intent question, not on MEET.
    const after = await db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { onboardingStage: true } });
    expect(after.onboardingStage).toBe("INTENT");
  });

  it("refuses Dating for a gender that has no opposite, rather than leaving an empty deck unexplained", async () => {
    const user = await onboardingUser("UNSPECIFIED");
    await expect(saveConnectionIntent(user, { connectionIntent: "DATING" }, { db })).rejects.toThrow(/Woman or Man/i);
    expect(canDate("UNSPECIFIED")).toBe(false);
    expect(canDate("MAN") && canDate("WOMAN")).toBe(true);
  });
});

describe("Friendship asks nothing more, for every gender", () => {
  for (const gender of ["MAN", "WOMAN"] as const) {
    it(`${gender} + Friendship goes straight to location, with no Show me invented`, async () => {
      const user = await onboardingUser(gender);
      await saveConnectionIntent(user, { connectionIntent: "FRIENDSHIP" }, { db });
      const row = await prefs(user.userId);
      expect(row.connectionIntent).toBe("FRIENDSHIP");
      // Not an answer they gave: the member's own Friendship preference stays unset.
      expect(row.friendshipInterestedIn).toBeNull();
      const after = await db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { onboardingStage: true } });
      expect(after.onboardingStage).toBe("LOCATION");
    });
  }

  it("a legacy Prefer-not-to-say member mid-onboarding can still choose Friendship", async () => {
    const user = await onboardingUser("UNSPECIFIED");
    await saveConnectionIntent(user, { connectionIntent: "FRIENDSHIP" }, { db });
    expect((await prefs(user.userId)).connectionIntent).toBe("FRIENDSHIP");
  });
});

describe("changing gender or intent later", () => {
  it("a gender change on Dating leaves the stored Show me alone and the deck follows the new gender", async () => {
    const location = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const user = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", connectionIntent: "DATING", locationId: location.id });
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING" });
    await updateInfo(user, { gender: "WOMAN", locationId: location.id, homeLocationId: null, occupation: "", education: "", heightCm: null }, { db });
    expect((await prefs(user.userId)).interestedIn).toBe("WOMEN");
    expect(await getDeckCandidateIds(db, user, { now: T0 })).toContain(man.userId);
  });

  it("a gender change leaves a Friendship preference alone", async () => {
    const location = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const user = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", locationId: location.id });
    await updateInfo(user, { gender: "WOMAN", locationId: location.id, homeLocationId: null, occupation: "", education: "", heightCm: null }, { db });
    const row = await prefs(user.userId);
    expect(row.interestedIn).toBe("EVERYONE");
    expect(row.friendshipInterestedIn).toBe("EVERYONE");
  });

  it("Friendship → Dating changes only the pool; both stored Show me values are left exactly as they were", async () => {
    const user = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "MEN" });
    await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: "DATING", interestedIn: "MEN", myIntent: "DATING" }, { db, now: T0 });
    const row = await prefs(user.userId);
    expect(row.connectionIntent).toBe("DATING");
    expect(row.interestedIn).toBe("MEN");
    expect(row.friendshipInterestedIn).toBe("MEN");
  });

  it("Dating → Friendship needs no gender choice and does not invent one as theirs", async () => {
    const user = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    expect((await prefs(user.userId)).friendshipInterestedIn).toBeNull();
    await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: "FRIENDSHIP" }, { db, now: T0 });
    const row = await prefs(user.userId);
    expect(row.connectionIntent).toBe("FRIENDSHIP");
    expect(row.friendshipInterestedIn).toBeNull();
  });

  it("Dating → Friendship → Dating → Friendship round-trips without asking anything", async () => {
    const user = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", interestedIn: "MEN" });
    for (const pool of ["FRIENDSHIP", "DATING", "FRIENDSHIP"] as const) {
      const back = await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: pool }, { db, now: T0 });
      expect(back.connectionIntent).toBe(pool);
    }
  });

  it("the filters DTO carries no Show me and no Looking for", async () => {
    const user = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    const dto = await getDiscoveryFilters(user, { db, now: T0 });
    for (const key of ["interestedIn", "interestedInEditable", "datingInterestedIn", "friendshipInterestedIn", "intent"]) expect(key in dto).toBe(false);
    expect(dto.canDate).toBe(true);
  });

  it("refuses a direct filter save that would put a man in the men's dating pool", async () => {
    const user = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: "DATING", interestedIn: "MEN" }, { db, now: T0 });
    expect((await prefs(user.userId)).interestedIn).toBe("WOMEN");
  });
});

describe("discovery keeps the two pools apart", () => {
  it("a Dating member is never shown a Friendship-only member", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    const dater = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", interestedIn: "MEN" });
    const friend = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const ids = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(ids).toContain(dater.userId);
    expect(ids).not.toContain(friend.userId);
  });

  it("a Friendship member never enters the Dating pool", async () => {
    const viewer = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const dater = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    const friend = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const ids = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(ids).toContain(friend.userId);
    expect(ids).not.toContain(dater.userId);
  });

  it("Friendship shows everyone in the pool, whatever an old Show me says on either side", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "MEN" });
    const manOpenToMen = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "MEN" });
    const manOpenToWomen = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    const woman = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const ids = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(ids).toEqual(expect.arrayContaining([manOpenToMen.userId, manOpenToWomen.userId, woman.userId]));
  });

  it("Friendship → Everyone allows both genders", async () => {
    const viewer = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const woman = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const ids = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(ids).toEqual(expect.arrayContaining([man.userId, woman.userId]));
  });

  it("a man looking for male friends sees male Friendship profiles, not the Dating pool", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "MEN" });
    const friendlyMan = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const datingMan = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    const ids = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(ids).toContain(friendlyMan.userId);
    expect(ids).not.toContain(datingMan.userId);
  });

  it("still applies blocks, visibility and photo moderation inside a pool", async () => {
    const viewer = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const blocked = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const hidden = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", visibility: "HIDDEN" });
    const unmoderated = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", photoModeration: "REJECTED" });
    const visible = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    await blockUser(viewer, blocked.userId, { db, now: T0 });
    const ids = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(ids).toContain(visible.userId);
    expect(ids).not.toContain(blocked.userId);
    expect(ids).not.toContain(hidden.userId);
    expect(ids).not.toContain(unmoderated.userId);
  });
});

/*
 * Rows written before this policy existed.
 *
 * Production carries two: a man on Dating whose "Show me" says EVERYONE, and a member who chose "Prefer not to
 * say". Neither is rewritten by the migration — their data is theirs — so the invariant has to hold at read time
 * instead, which is what `genderCompatibilitySql` does for the Dating pool. These tests reproduce both rows exactly
 * as production holds them.
 */
describe("legacy rows are honoured without being rewritten", () => {
  it("a man on Dating stored as EVERYONE still sees only women, and is seen only by women", async () => {
    const legacy = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "EVERYONE" });
    const woman = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", interestedIn: "MEN" });
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });

    const sees = await getDeckCandidateIds(db, legacy, { now: T0 });
    expect(sees).toContain(woman.userId);
    expect(sees).not.toContain(man.userId);
    // And the other way: the woman sees him, the man does not.
    expect(await getDeckCandidateIds(db, woman, { now: T0 })).toContain(legacy.userId);
    expect(await getDeckCandidateIds(db, man, { now: T0 })).not.toContain(legacy.userId);

    // The stored row is untouched by any of that reading.
    expect((await prefs(legacy.userId)).interestedIn).toBe("EVERYONE");
  });

  it("an UNSPECIFIED member defaulted to Dating is out of the pool in both directions, and their row is intact", async () => {
    const legacy = await createUser(db, { now: T0, gender: "UNSPECIFIED", connectionIntent: "DATING", interestedIn: "WOMEN" });
    const woman = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", interestedIn: "MEN" });
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });

    expect(await getDeckCandidateIds(db, legacy, { now: T0 })).toEqual([]);
    expect(await getDeckCandidateIds(db, woman, { now: T0 })).not.toContain(legacy.userId);
    expect(await getDeckCandidateIds(db, man, { now: T0 })).not.toContain(legacy.userId);

    const row = await prefs(legacy.userId);
    expect(row.interestedIn).toBe("WOMEN");
    expect(row.connectionIntent).toBe("DATING");
  });

  it("resolving the gender to Man puts them into Dating discovery", async () => {
    const location = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const legacy = await createUser(db, { now: T0, gender: "UNSPECIFIED", connectionIntent: "DATING", interestedIn: "WOMEN", locationId: location.id });
    const woman = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", interestedIn: "MEN" });
    expect(await getDeckCandidateIds(db, legacy, { now: T0 })).toEqual([]);

    await updateInfo(legacy, { gender: "MAN", locationId: location.id, homeLocationId: null, occupation: "", education: "", heightCm: null }, { db });

    // The row is untouched; the deck follows from gender and pool alone.
    expect((await prefs(legacy.userId)).interestedIn).toBe("WOMEN");
    expect(await getDeckCandidateIds(db, legacy, { now: T0 })).toContain(woman.userId);
    expect(await getDeckCandidateIds(db, woman, { now: T0 })).toContain(legacy.userId);
  });

  it("an UNSPECIFIED member on Friendship sees and is seen by everyone in the pool, whatever either Show me says", async () => {
    const legacy = await createUser(db, { now: T0, gender: "UNSPECIFIED", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    expect(await getDeckCandidateIds(db, legacy, { now: T0 })).toContain(man.userId);
    expect(await getDeckCandidateIds(db, man, { now: T0 })).toContain(legacy.userId);
    expect((await prefs(legacy.userId)).interestedIn).toBe("WOMEN");
  });
});

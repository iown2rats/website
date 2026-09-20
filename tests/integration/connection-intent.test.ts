import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveConnectionIntent, saveGender, saveInterestedIn, saveName } from "@/server/onboarding/onboarding";
import { getDiscoveryFilters, saveDiscoveryFilters } from "@/server/discovery/filters";
import { getDeckCandidateIds } from "@/server/discovery/query";
import { datingInterestedIn, resolvePreferences } from "@/server/preferences/intent-policy";
import { updateInfo } from "@/server/profiles/edit";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { createLocation, createUser } from "../helpers/factory";

/*
 * Dating vs Friendship (docs/ARCHITECTURE.md §7.5).
 *
 * Two things are being protected here. The first is that Dating never asks a question with one answer and never
 * accepts one from a request: the preference is computed from gender at the server boundary, so the UI is a
 * convenience rather than the rule. The second is that the two pools do not leak into each other, which is checked
 * against the real deck query rather than against the policy function, because the policy being right is no comfort
 * if the SQL disagrees with it.
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

describe("Dating derives the preference instead of asking", () => {
  it("a man choosing Dating is set to Women", async () => {
    const user = await onboardingUser("MAN");
    await saveConnectionIntent(user, { connectionIntent: "DATING" }, { db });
    const row = await prefs(user.userId);
    expect(row.connectionIntent).toBe("DATING");
    expect(row.interestedIn).toBe("WOMEN");
  });

  it("a woman choosing Dating is set to Men", async () => {
    const user = await onboardingUser("WOMAN");
    await saveConnectionIntent(user, { connectionIntent: "DATING" }, { db });
    const row = await prefs(user.userId);
    expect(row.connectionIntent).toBe("DATING");
    expect(row.interestedIn).toBe("MEN");
  });

  it("skips the 'who would you like to meet' step entirely", async () => {
    const user = await onboardingUser("MAN");
    await saveConnectionIntent(user, { connectionIntent: "DATING" }, { db });
    // The pointer lands on the relationship-intent question, not on MEET.
    const after = await db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { onboardingStage: true } });
    expect(after.onboardingStage).toBe("INTENT");
  });

  it("refuses a Dating preference submitted directly, whatever the UI did", async () => {
    const user = await onboardingUser("MAN");
    await saveConnectionIntent(user, { connectionIntent: "DATING" }, { db });
    // MAN + DATING + MEN, posted straight at the server.
    await expect(saveInterestedIn(user, { interestedIn: "MEN" }, { db })).rejects.toThrow(/nothing to choose/i);
    expect((await prefs(user.userId)).interestedIn).toBe("WOMEN");
  });

  it("refuses a woman posting WOMEN for Dating", async () => {
    const user = await onboardingUser("WOMAN");
    await saveConnectionIntent(user, { connectionIntent: "DATING" }, { db });
    await expect(saveInterestedIn(user, { interestedIn: "WOMEN" }, { db })).rejects.toThrow(/nothing to choose/i);
    expect((await prefs(user.userId)).interestedIn).toBe("MEN");
  });

  it("refuses Dating for a gender that has no opposite, rather than leaving an empty deck unexplained", async () => {
    const user = await onboardingUser("UNSPECIFIED");
    await expect(saveConnectionIntent(user, { connectionIntent: "DATING" }, { db })).rejects.toThrow(/Woman or Man/i);
    expect(datingInterestedIn("UNSPECIFIED")).toBeNull();
  });

  it("never accepts an invalid combination through the policy itself", () => {
    expect(resolvePreferences({ gender: "MAN", connectionIntent: "DATING", friendshipInterestedIn: "MEN" }).interestedIn).toBe("WOMEN");
    expect(resolvePreferences({ gender: "WOMAN", connectionIntent: "DATING", friendshipInterestedIn: "WOMEN" }).interestedIn).toBe("MEN");
  });
});

describe("Friendship asks, for every gender", () => {
  for (const gender of ["MAN", "WOMAN", "UNSPECIFIED"] as const) {
    for (const choice of ["MEN", "WOMEN", "EVERYONE"] as const) {
      it(`${gender} + Friendship → ${choice}`, async () => {
        const user = await onboardingUser(gender);
        await saveConnectionIntent(user, { connectionIntent: "FRIENDSHIP" }, { db });
        await saveInterestedIn(user, { interestedIn: choice }, { db });
        const row = await prefs(user.userId);
        expect(row.connectionIntent).toBe("FRIENDSHIP");
        expect(row.interestedIn).toBe(choice);
        expect(row.friendshipInterestedIn).toBe(choice);
      });
    }
  }

  it("never forces the opposite gender", async () => {
    const man = await onboardingUser("MAN");
    await saveConnectionIntent(man, { connectionIntent: "FRIENDSHIP" }, { db });
    await saveInterestedIn(man, { interestedIn: "MEN" }, { db });
    expect((await prefs(man.userId)).interestedIn).toBe("MEN");
  });

  it("asks on the next step when there is no remembered answer", async () => {
    const user = await onboardingUser("WOMAN");
    await saveConnectionIntent(user, { connectionIntent: "FRIENDSHIP" }, { db });
    const after = await db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { onboardingStage: true } });
    expect(after.onboardingStage).toBe("MEET");
  });
});

describe("changing gender or intent later", () => {
  it("a gender change recalculates the Dating preference", async () => {
    const location = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const user = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", connectionIntent: "DATING", locationId: location.id });
    await updateInfo(user, { gender: "WOMAN", locationId: location.id, homeLocationId: null, occupation: "", education: "", heightCm: null }, { db });
    expect((await prefs(user.userId)).interestedIn).toBe("MEN");
  });

  it("a gender change leaves a Friendship preference alone", async () => {
    const location = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const user = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", locationId: location.id });
    await updateInfo(user, { gender: "WOMAN", locationId: location.id, homeLocationId: null, occupation: "", education: "", heightCm: null }, { db });
    const row = await prefs(user.userId);
    expect(row.interestedIn).toBe("EVERYONE");
    expect(row.friendshipInterestedIn).toBe("EVERYONE");
  });

  it("Friendship → Dating enforces the derived preference", async () => {
    const user = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "MEN" });
    await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: "DATING", interestedIn: "MEN" }, { db, now: T0 });
    const row = await prefs(user.userId);
    expect(row.connectionIntent).toBe("DATING");
    expect(row.interestedIn).toBe("WOMEN");
    // Their own Friendship answer survives the round trip.
    expect(row.friendshipInterestedIn).toBe("MEN");
  });

  it("Dating → Friendship does not hand them the derived Dating value as their own choice", async () => {
    const user = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    expect((await prefs(user.userId)).friendshipInterestedIn).toBeNull();
    // The sheet asks, and the answer submitted with the switch is recorded as theirs.
    await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" }, { db, now: T0 });
    const row = await prefs(user.userId);
    expect(row.interestedIn).toBe("EVERYONE");
    expect(row.friendshipInterestedIn).toBe("EVERYONE");
  });

  it("Dating → Friendship → Dating → Friendship remembers the answer instead of re-asking", async () => {
    const user = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", interestedIn: "MEN" });
    await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" }, { db, now: T0 });
    await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: "DATING", interestedIn: "WOMEN" }, { db, now: T0 });
    const back = await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" }, { db, now: T0 });
    expect(back.interestedIn).toBe("WOMEN");
  });

  it("reports Show me as read-only on Dating and editable on Friendship", async () => {
    const user = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    const dating = await getDiscoveryFilters(user, { db, now: T0 });
    expect(dating.interestedInEditable).toBe(false);
    expect(dating.datingInterestedIn).toBe("WOMEN");
    await saveDiscoveryFilters(user, { ...FILTERS, connectionIntent: "FRIENDSHIP", interestedIn: "MEN" }, { db, now: T0 });
    expect((await getDiscoveryFilters(user, { db, now: T0 })).interestedInEditable).toBe(true);
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

  it("Friendship filters by gender, in both directions", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "MEN" });
    // Wants men, and is a man: mutual.
    const manOpenToMen = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "MEN" });
    // A man who only wants women as friends: the viewer wants him, he does not want the viewer.
    const manOpenToWomen = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    // A woman: the viewer asked for men.
    const woman = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const ids = await getDeckCandidateIds(db, viewer, { now: T0 });
    expect(ids).toContain(manOpenToMen.userId);
    expect(ids).not.toContain(manOpenToWomen.userId);
    expect(ids).not.toContain(woman.userId);
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

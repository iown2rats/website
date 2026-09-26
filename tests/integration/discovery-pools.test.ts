import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { getDeck, passByHandle, undoAndRestore } from "@/server/discovery/deck";
import { saveDiscoveryFilters } from "@/server/discovery/filters";
import { getDeckCandidateIds, isDeckCandidate } from "@/server/discovery/query";
import { blockUser } from "@/server/safety/block";
import {
  completeOnboarding,
  confirmPhotos,
  getOnboardingData,
  saveAbout,
  saveConnectionIntent,
  saveDateOfBirth,
  saveGender,
  saveIntent,
  saveLocation,
  saveName,
  savePrivacy,
} from "@/server/onboarding/onboarding";
import { resumeSlug, stepNumber, totalSteps } from "@/server/onboarding/stages";
import { createAccount } from "@/server/users/account";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createLocation, createUser, grantPlus, hours, type TestUser } from "../helpers/factory";

/*
 * Who can see whom (docs/ARCHITECTURE.md §7.5), as of 2026-09-26:
 *
 *   Dating     = opposite gender, Dating pool.
 *   Friendship = everyone in the Friendship pool; gender plays no part at all.
 *   The pools never mix.
 *
 * Nothing else about gender is a choice: "Show me" is gone from onboarding, Filters and the predicate, and the old
 * stored values are neither read by any discovery query nor rewritten. Relationship intention ("What are you looking
 * for?") is shown on profiles but never filters anybody, and a missing answer never hides anybody. The age range is
 * the viewer's own and one-way.
 *
 * Every assertion runs the real deck query in both directions, because "A sees B" says nothing about "B sees A".
 */
const db = testDb();
const T0 = new Date("2026-09-26T12:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const deps = (now = T0) => ({ db, storage, now });

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

type Gender = "WOMAN" | "MAN";
type LegacyGender = Gender | "UNSPECIFIED";
type Pool = "DATING" | "FRIENDSHIP";
type Intention = "SERIOUS_RELATIONSHIP" | "DATING" | "MARRIAGE" | "FIGURING_OUT" | null;
type ShowMe = "WOMEN" | "MEN" | "EVERYONE";

const sees = async (viewer: TestUser, other: TestUser) => (await getDeckCandidateIds(db, viewer, { now: T0 })).includes(other.userId);
const mutual = async (a: TestUser, b: TestUser) => [await sees(a, b), await sees(b, a)];

describe("Dating: opposite gender, whatever either member's relationship intention", () => {
  const INTENTIONS: Intention[] = ["MARRIAGE", "SERIOUS_RELATIONSHIP", "DATING", "FIGURING_OUT", null];

  it("every man × woman intention pair is visible both ways, including no answer on either side", async () => {
    const men = await Promise.all(INTENTIONS.map((intent) => createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN", intent })));
    const women = await Promise.all(INTENTIONS.map((intent) => createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", interestedIn: "MEN", intent })));
    for (const man of men) expect((await getDeckCandidateIds(db, man, { now: T0 })).sort()).toEqual(women.map((w) => w.userId).sort());
    for (const woman of women) expect((await getDeckCandidateIds(db, woman, { now: T0 })).sort()).toEqual(men.map((m) => m.userId).sort());
  });

  it("a stored Looking for (the old filter) no longer narrows anything", async () => {
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", intent: "MARRIAGE", lookingFor: "MARRIAGE" });
    const casual = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", intent: "DATING", lookingFor: "SERIOUS_RELATIONSHIP" });
    const unanswered = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", intent: null, lookingFor: "FIGURING_OUT" });
    expect(await mutual(man, casual)).toEqual([true, true]);
    expect(await mutual(man, unanswered)).toEqual([true, true]);
    // Stored, not rewritten.
    expect((await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: man.userId } })).intent).toBe("MARRIAGE");
  });

  it("Man ↔ Man and Woman ↔ Woman are never visible on Dating, even with a contradictory legacy Show me", async () => {
    const m1 = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "MEN" });
    const m2 = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "EVERYONE" });
    const w1 = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    const w2 = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", interestedIn: "EVERYONE" });
    expect(await mutual(m1, m2)).toEqual([false, false]);
    expect(await mutual(w1, w2)).toEqual([false, false]);
    // And the contradictory values still see the opposite gender.
    expect(await mutual(m1, w1)).toEqual([true, true]);
    expect(await mutual(m2, w2)).toEqual([true, true]);
  });
});

describe("Friendship: no gender rule at all, whatever the old Show me says", () => {
  const FRIENDSHIP_PAIRS: [LegacyGender, LegacyGender][] = [
    ["MAN", "MAN"], ["MAN", "WOMAN"], ["WOMAN", "WOMAN"],
    ["UNSPECIFIED", "MAN"], ["UNSPECIFIED", "WOMAN"], ["UNSPECIFIED", "UNSPECIFIED"],
  ];
  for (const [a, b] of FRIENDSHIP_PAIRS) {
    it(`${a} ↔ ${b} → visible both ways, even when both stored Show me values exclude the other`, async () => {
      // The most exclusive legacy value each could hold against the other.
      const against = (other: LegacyGender): ShowMe => (other === "WOMAN" ? "MEN" : "WOMEN");
      const x = await createUser(db, { now: T0, gender: a, connectionIntent: "FRIENDSHIP", interestedIn: against(b), friendshipInterestedIn: against(b), intent: null });
      const y = await createUser(db, { now: T0, gender: b, connectionIntent: "FRIENDSHIP", interestedIn: against(a), friendshipInterestedIn: against(a), intent: null });
      expect(await mutual(x, y)).toEqual([true, true]);
      // Nothing was rewritten to make that true.
      const stored = await db.discoveryPreferences.findMany({ where: { userId: { in: [x.userId, y.userId] } }, select: { userId: true, interestedIn: true } });
      expect(stored.find((r) => r.userId === x.userId)?.interestedIn).toBe(against(b));
      expect(stored.find((r) => r.userId === y.userId)?.interestedIn).toBe(against(a));
    });
  }

  it("every gender × every stored Show me sees everyone else in the pool", async () => {
    const people: { user: TestUser; label: string }[] = [];
    for (const gender of ["MAN", "WOMAN", "UNSPECIFIED"] as LegacyGender[]) {
      for (const showMe of ["WOMEN", "MEN", "EVERYONE"] as ShowMe[]) {
        people.push({ label: `${gender}/${showMe}`, user: await createUser(db, { now: T0, gender, connectionIntent: "FRIENDSHIP", interestedIn: showMe, friendshipInterestedIn: showMe, intent: null }) });
      }
    }
    for (const viewer of people) {
      const deck = await getDeckCandidateIds(db, viewer.user, { now: T0 });
      const others = people.filter((p) => p !== viewer);
      expect({ viewer: viewer.label, deck: deck.sort() }).toEqual({ viewer: viewer.label, deck: others.map((p) => p.user.userId).sort() });
    }
  });

  it("a Friendship member's relationship intention (stale or none) hides nobody", async () => {
    const a = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", intent: "MARRIAGE", lookingFor: "MARRIAGE" });
    const b = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", intent: null });
    expect(await mutual(a, b)).toEqual([true, true]);
  });
});

describe("the pools never mix", () => {
  for (const dg of ["MAN", "WOMAN"] as Gender[]) {
    for (const fg of ["MAN", "WOMAN"] as Gender[]) {
      it(`${dg} Dating + ${fg} Friendship → not visible either way`, async () => {
        const dater = await createUser(db, { now: T0, gender: dg, connectionIntent: "DATING", interestedIn: "EVERYONE" });
        const friend = await createUser(db, { now: T0, gender: fg, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
        expect(await mutual(dater, friend)).toEqual([false, false]);
      });
    }
  }
});

describe("legacy 'Prefer not to say'", () => {
  it("on Dating they see nobody and nobody sees them, exactly as before", async () => {
    const pnts = await createUser(db, { now: T0, gender: "UNSPECIFIED", connectionIntent: "DATING", interestedIn: "EVERYONE" });
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING" });
    const woman = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING" });
    expect(await getDeckCandidateIds(db, pnts, { now: T0 })).toEqual([]);
    expect(await sees(man, pnts)).toBe(false);
    expect(await sees(woman, pnts)).toBe(false);
  });

  it("on Friendship they are an ordinary member of the pool, and age, blocks and swipes still apply", async () => {
    const pnts = await createUser(db, { now: T0, gender: "UNSPECIFIED", connectionIntent: "FRIENDSHIP", interestedIn: "MEN", age: 30, ageMin: 25, ageMax: 35 });
    const inRange = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN", age: 28 });
    const tooOld = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", age: 50 });
    const blocked = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", age: 29 });
    const passed = await createUser(db, { now: T0, gender: "UNSPECIFIED", connectionIntent: "FRIENDSHIP", age: 31 });
    await blockUser(blocked, pnts.userId, { db, now: T0 });
    await passByHandle(pnts, passed.handle, deps());
    expect(await getDeckCandidateIds(db, pnts, { now: T0 })).toEqual([inRange.userId]);
    expect(await sees(inRange, pnts)).toBe(true);
    expect(await sees(tooOld, pnts)).toBe(true);
    expect(await sees(blocked, pnts)).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: pnts.userId } })).gender).toBe("UNSPECIFIED");
  });
});

describe("age: the viewer's own range, one-way, 3-year minimum span", () => {
  it("a viewer set to 18–30 sees a 27-year-old whose own range (40–60) leaves the viewer out, and not a 35-year-old", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", age: 25, ageMin: 18, ageMax: 30 });
    const twentySeven = await createUser(db, { now: T0, gender: "WOMAN", age: 27, ageMin: 40, ageMax: 60 });
    const thirtyFive = await createUser(db, { now: T0, gender: "WOMAN", age: 35, ageMin: 18, ageMax: 60 });
    expect(await sees(viewer, twentySeven)).toBe(true);
    expect(await sees(viewer, thirtyFive)).toBe(false);
    // One-way: her range decides her deck, not his.
    expect(await sees(twentySeven, viewer)).toBe(false);
    expect(await sees(thirtyFive, viewer)).toBe(true);
  });

  it("the same rule applies on Friendship", async () => {
    const viewer = await createUser(db, { now: T0, gender: "WOMAN", age: 25, ageMin: 18, ageMax: 30, connectionIntent: "FRIENDSHIP" });
    const inRange = await createUser(db, { now: T0, gender: "WOMAN", age: 27, ageMin: 40, ageMax: 60, connectionIntent: "FRIENDSHIP" });
    const outOfRange = await createUser(db, { now: T0, gender: "MAN", age: 35, connectionIntent: "FRIENDSHIP" });
    expect(await sees(viewer, inRange)).toBe(true);
    expect(await sees(viewer, outOfRange)).toBe(false);
  });

  it("a range narrower than 3 years cannot be saved", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN" });
    const base = { connectionIntent: "DATING", locationScope: "ANYWHERE" };
    await expect(saveDiscoveryFilters(viewer, { ...base, ageMin: 30, ageMax: 32 }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveDiscoveryFilters(viewer, { ...base, ageMin: 30, ageMax: 33 }, { db, now: T0 })).resolves.toMatchObject({ ageMin: 30, ageMax: 33 });
  });
});

describe("switching pools needs no gender choice, both ways", () => {
  it("Dating ↔ Friendship carries only the pool; the deck follows immediately", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "WOMEN" });
    const datingWoman = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING" });
    const friendMan = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    const filters = { ageMin: 18, ageMax: 60, locationScope: "ANYWHERE" };
    expect(await getDeckCandidateIds(db, me, { now: T0 })).toEqual([datingWoman.userId]);
    await saveDiscoveryFilters(me, { ...filters, connectionIntent: "FRIENDSHIP" }, { db, now: T0 });
    expect(await getDeckCandidateIds(db, me, { now: T0 })).toEqual([friendMan.userId]);
    await saveDiscoveryFilters(me, { ...filters, connectionIntent: "DATING" }, { db, now: T0 });
    expect(await getDeckCandidateIds(db, me, { now: T0 })).toEqual([datingWoman.userId]);
  });

  it("switching into Dating without an intention answer is allowed and hides nobody", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", intent: null });
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", intent: "MARRIAGE" });
    await saveDiscoveryFilters(me, { connectionIntent: "DATING", ageMin: 18, ageMax: 60, locationScope: "ANYWHERE" }, { db, now: T0 });
    expect(await mutual(me, man)).toEqual([true, true]);
    expect((await db.profile.findUniqueOrThrow({ where: { userId: me.userId } })).intent).toBeNull();
  });
});

describe("onboarding: Gender → Connection → (Dating: intention | Friendship: straight on)", () => {
  const onboard = async (gender: Gender, pool: Pool, locId: string) => {
    const account = await createAccount(db, T0);
    const actor = { userId: account.id };
    await saveName(actor, { name: `${gender} ${pool}` }, { db });
    await saveDateOfBirth(actor, { day: 1, month: 1, year: 1998 }, { db, now: T0 });
    await saveGender(actor, { gender }, { db });
    await saveConnectionIntent(actor, { connectionIntent: pool }, { db });
    const afterConnection = resumeSlug((await getOnboardingData(actor, { db })).stage, pool);
    if (pool === "DATING") await saveIntent(actor, { intent: "FIGURING_OUT" }, { db });
    await saveLocation(actor, { locationId: locId }, { db });
    const profile = await db.profile.findUniqueOrThrow({ where: { userId: actor.userId } });
    for (const i of [0, 1]) {
      await db.profilePhoto.create({ data: { profileId: profile.id, position: i, storageKey: `t/${actor.userId}/${i}`, thumbKey: `t/${actor.userId}/${i}t`, blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH", width: 1080, height: 1440, moderation: "APPROVED" } });
    }
    await confirmPhotos(actor, { db });
    await saveAbout(actor, { bio: "", interestIds: [], prompts: [] }, { db });
    await savePrivacy(actor, { hideLocation: false, hideAge: false }, { db });
    await completeOnboarding(actor, { db, now: T0 });
    return { actor: { ...actor, handle: "", phoneE164: "" } as TestUser, afterConnection };
  };

  it("new signups for all four gender/pool combinations finish, and land in the right decks", async () => {
    const loc = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const dm = await onboard("MAN", "DATING", loc.id);
    const dw = await onboard("WOMAN", "DATING", loc.id);
    const fm = await onboard("MAN", "FRIENDSHIP", loc.id);
    const fw = await onboard("WOMAN", "FRIENDSHIP", loc.id);
    // Dating asks the intention next; Friendship goes straight to location.
    expect([dm.afterConnection, dw.afterConnection]).toEqual(["intention", "intention"]);
    expect([fm.afterConnection, fw.afterConnection]).toEqual(["location", "location"]);
    // No "Show me" was asked, and none was invented for Friendship.
    expect((await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: fm.actor.userId } })).friendshipInterestedIn).toBeNull();
    // Friendship completed with no intention on file.
    expect((await db.profile.findUniqueOrThrow({ where: { userId: fw.actor.userId } })).intent).toBeNull();

    expect(await getDeckCandidateIds(db, dm.actor, { now: T0 })).toEqual([dw.actor.userId]);
    expect(await getDeckCandidateIds(db, dw.actor, { now: T0 })).toEqual([dm.actor.userId]);
    expect(await getDeckCandidateIds(db, fm.actor, { now: T0 })).toEqual([fw.actor.userId]);
    expect(await getDeckCandidateIds(db, fw.actor, { now: T0 })).toEqual([fm.actor.userId]);
  });

  it("new members can choose only Woman or Man", async () => {
    const account = await createAccount(db, T0);
    const actor = { userId: account.id };
    await saveName(actor, { name: "New" }, { db });
    await expect(saveGender(actor, { gender: "UNSPECIFIED" }, { db })).rejects.toThrow(/Woman or Man/);
  });

  it("step totals follow the path: Dating 11, Friendship 10, with no hole where MEET was", () => {
    expect(totalSteps("DATING")).toBe(11);
    expect(totalSteps("FRIENDSHIP")).toBe(10);
    expect(stepNumber("CONNECTION", "DATING")).toBe(5);
    expect(stepNumber("INTENT", "DATING")).toBe(6);
    expect(stepNumber("LOCATION", "DATING")).toBe(7);
    expect(stepNumber("LOCATION", "FRIENDSHIP")).toBe(6);
    expect(stepNumber("PRIVACY", "FRIENDSHIP")).toBe(9);
  });

  for (const pool of ["DATING", "FRIENDSHIP"] as Pool[]) {
    it(`a ${pool} member stored at the old MEET stage resumes at the next real question and can finish`, async () => {
      const loc = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
      const account = await createAccount(db, T0);
      const actor = { userId: account.id };
      await saveName(actor, { name: "Parked" }, { db });
      await saveDateOfBirth(actor, { day: 1, month: 1, year: 1998 }, { db, now: T0 });
      await saveGender(actor, { gender: "WOMAN" }, { db });
      await saveConnectionIntent(actor, { connectionIntent: pool }, { db });
      // Exactly how production would hold a member who stopped at the removed question.
      await db.user.update({ where: { id: actor.userId }, data: { onboardingStage: "MEET" } });

      const data = await getOnboardingData(actor, { db });
      const expected = pool === "DATING" ? "intention" : "location";
      expect(resumeSlug(data.stage, data.connectionIntent)).toBe(expected);
      // Legacy default argument: routes that do not know the pool yet still never send anyone to /meet.
      expect(resumeSlug("MEET")).not.toBe("meet");
      // Reading is read-only: the stored pointer is not rewritten until the member saves.
      expect((await db.user.findUniqueOrThrow({ where: { id: actor.userId } })).onboardingStage).toBe("MEET");

      if (pool === "DATING") await saveIntent(actor, { intent: "MARRIAGE" }, { db });
      await saveLocation(actor, { locationId: loc.id }, { db });
      expect((await db.user.findUniqueOrThrow({ where: { id: actor.userId } })).onboardingStage).toBe("PHOTOS");
      const profile = await db.profile.findUniqueOrThrow({ where: { userId: actor.userId } });
      for (const i of [0, 1]) {
        await db.profilePhoto.create({ data: { profileId: profile.id, position: i, storageKey: `t/p/${i}`, thumbKey: `t/p/${i}t`, blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH", width: 1080, height: 1440, moderation: "APPROVED" } });
      }
      await confirmPhotos(actor, { db });
      await saveAbout(actor, { bio: "", interestIds: [], prompts: [] }, { db });
      await savePrivacy(actor, { hideLocation: false, hideAge: false }, { db });
      await completeOnboarding(actor, { db, now: T0 });
      expect((await db.user.findUniqueOrThrow({ where: { id: actor.userId } })).status).toBe("ACTIVE");
    });
  }
});

describe("empty-deck reasons and Undo follow the same rules", () => {
  it("a Friendship man whose only possible friend is a man with a stored 'women only' now gets a card, not an empty deck", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    const other = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    const page = await getDeck(me, {}, deps());
    expect(page.cards.map((c) => c.handle)).toEqual([other.handle]);
    expect(page.emptyReason).toBe("NONE");
  });

  it("FILTERS counts candidates under the new rules (a stored Show me would have made it UNAVAILABLE)", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", age: 22, ageMin: 18, ageMax: 25, connectionIntent: "FRIENDSHIP", interestedIn: "MEN" });
    await createUser(db, { now: T0, gender: "WOMAN", age: 40, connectionIntent: "FRIENDSHIP", interestedIn: "MEN" });
    expect((await getDeck(me, {}, deps())).emptyReason).toBe("FILTERS");
  });

  it("EXHAUSTED once the viewer has passed everyone compatible, even with a stale Looking for", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", lookingFor: "MARRIAGE" });
    const her = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", intent: null });
    await passByHandle(me, her.handle, deps());
    expect((await getDeck(me, {}, deps(at(T0, 1000)))).emptyReason).toBe("EXHAUSTED");

  });

  it("UNAVAILABLE when the only people here are in the other pool or the same gender on Dating", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING" });
    await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP" });
    await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", interestedIn: "MEN" });
    expect((await getDeck(me, {}, deps())).emptyReason).toBe("UNAVAILABLE");
  });

  it("Undo restores a card the old Show me or Looking for would have refused", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    await passByHandle(me, man.handle, deps());
    expect((await undoAndRestore(me, deps(at(T0, 1000)))).card?.handle).toBe(man.handle);

    const dater = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "DATING", lookingFor: "MARRIAGE" });
    await grantPlus(db, dater.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const unanswered = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING", intent: null });
    expect(await isDeckCandidate(db, dater, unanswered.userId, T0)).toBe(true);
    await passByHandle(dater, unanswered.handle, deps());
    expect((await undoAndRestore(dater, deps(at(T0, 1000)))).card?.handle).toBe(unanswered.handle);
  });

  it("Undo never restores across pools or into a same-gender Dating deck", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING" });
    const man = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "DATING" });
    const friend = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP" });
    expect(await isDeckCandidate(db, me, man.userId, T0)).toBe(false);
    expect(await isDeckCandidate(db, me, friend.userId, T0)).toBe(false);
  });
});

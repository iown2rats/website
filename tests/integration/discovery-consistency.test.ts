import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { DISCOVERY } from "@/config/product";
import { InvalidStateError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { getUserDetail } from "@/server/admin/users";
import { listConversations } from "@/server/conversations/list";
import { getDeck } from "@/server/discovery/deck";
import { DEFAULT_FILTERS, getDiscoveryFilters, saveDiscoveryFilters } from "@/server/discovery/filters";
import { baseVisibleSql, compatibilitySql, discoverableSql, notSwipedSql, viewerFilterSql } from "@/server/discovery/predicate";
import { countRelaxedCandidates, getDeckCandidateIds, isDeckCandidate, loadViewerContext } from "@/server/discovery/query";
import { countEligibleIncomingLikes, listEligibleIncomingLikes } from "@/server/likes/eligibility";
import { CROSS_POOL_LIKE, likeUser } from "@/server/likes/like";
import {
  completeOnboarding,
  confirmPhotos,
  saveAbout,
  saveConnectionIntent,
  saveDateOfBirth,
  saveGender,
  saveLocation,
  saveName,
  savePrivacy,
} from "@/server/onboarding/onboarding";
import { DEFAULT_AGE_PREFERENCES } from "@/server/preferences/defaults";
import { getEditProfileData, updateAbout, updateInfo } from "@/server/profiles/edit";
import { buildVisibleProfiles } from "@/server/profiles/visible-profile";
import { createAccount } from "@/server/users/account";
import { visibilityMatrixSql } from "../../scripts/qa-visibility-sql";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { createLocation, createStaff, createUser, type TestUser } from "../helpers/factory";

/*
 * Discovery ↔ onboarding consistency (docs/ARCHITECTURE.md §7.4–§7.5).
 *
 * The production incident behind this file: a Friendship member could not see another member, and the audit found
 * the product model disagreeing with itself — a Dating-only "Looking for" filter applied to Friendship decks, a
 * Friendship member's stale dating answer shown and matched, a silent 22–34 default that hid members from their
 * own age group, the Filters sheet overwriting a remembered Friendship answer, likes crossing pools, and one empty
 * state for every kind of empty. Each describe block pins one corrected rule against the real queries.
 */
const db = testDb();
const T0 = new Date("2026-09-25T06:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

const deck = (viewer: TestUser) => getDeckCandidateIds(db, viewer, { now: T0, limit: 30 });
const BASE_FILTERS = { ageMin: 18, ageMax: 60, locationScope: "ANYWHERE" as const, locationId: null, heightMinCm: null, heightMaxCm: null, education: null };

describe("Dating intent never affects Friendship", () => {
  it("a Friendship viewer with a stored Dating 'Looking for' still sees Friendship members with no, or a different, dating answer", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", lookingFor: "MARRIAGE" });
    const neverAsked = await createUser(db, { now: T0, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: null });
    const stale = await createUser(db, { now: T0, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: "SERIOUS_RELATIONSHIP" });
    const ids = await deck(viewer);
    expect(ids).toEqual(expect.arrayContaining([neverAsked.userId, stale.userId]));
    expect(await isDeckCandidate(db, viewer, neverAsked.userId, T0)).toBe(true);
  });

  it("no visibility query reads relationship intention, in either pool (2026-09-26)", async () => {
    for (const connectionIntent of ["FRIENDSHIP", "DATING"] as const) {
      const viewer = await createUser(db, { now: T0, gender: "MAN", connectionIntent, lookingFor: "DATING" });
      const v = await loadViewerContext(db, viewer.userId, T0);
      expect("intent" in v).toBe(false);
      for (const sql of [viewerFilterSql(v, T0).sql, compatibilitySql(v).sql]) {
        expect(sql).not.toContain("p.intent");
        expect(sql).not.toContain("RelationshipIntent");
      }
    }
  });

  it("no discovery SQL reads the stored Show me (interestedIn), for any gender in either pool", async () => {
    for (const connectionIntent of ["FRIENDSHIP", "DATING"] as const) {
      for (const gender of ["MAN", "WOMAN", "UNSPECIFIED"] as const) {
        const viewer = await createUser(db, { now: T0, gender, connectionIntent, interestedIn: "WOMEN", friendshipInterestedIn: "WOMEN" });
        const v = await loadViewerContext(db, viewer.userId, T0);
        expect("interestedIn" in v).toBe(false);
        const all = [baseVisibleSql(v.userId, v.phoneHash, T0).sql, discoverableSql().sql, compatibilitySql(v).sql, viewerFilterSql(v, T0).sql, notSwipedSql(v.userId, T0).sql];
        for (const sql of all) expect(sql).not.toMatch(/interestedIn/i);
        // Friendship has no gender clause at all.
        if (connectionIntent === "FRIENDSHIP") expect(compatibilitySql(v).sql).not.toContain("gender");
      }
    }
    expect(visibilityMatrixSql("WITH cohort(id, handle) AS (SELECT NULL::text, NULL::text)")).not.toMatch(/interestedIn/i);
  });

  it("a Friendship candidate's stale dating answer is irrelevant to every Friendship viewer's stored filter", async () => {
    const candidate = await createUser(db, { now: T0, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: "MARRIAGE" });
    for (const lookingFor of ["SERIOUS_RELATIONSHIP", "DATING", "FIGURING_OUT", null] as const) {
      const viewer = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", lookingFor });
      expect(await deck(viewer)).toContain(candidate.userId);
    }
  });

  it("a Dating viewer's stored 'Looking for: Marriage' no longer narrows the deck: every answer, and none, is shown", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", lookingFor: "MARRIAGE" });
    const marriage = await createUser(db, { now: T0, gender: "WOMAN", intent: "MARRIAGE" });
    const serious = await createUser(db, { now: T0, gender: "WOMAN", intent: "SERIOUS_RELATIONSHIP" });
    const unanswered = await createUser(db, { now: T0, gender: "WOMAN", intent: null });
    expect((await deck(viewer)).sort()).toEqual([marriage.userId, serious.userId, unanswered.userId].sort());
  });

  it("a stored 'Looking for' survives every filters save untouched — never overwritten, never applied", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", lookingFor: "MARRIAGE", intent: "DATING" });
    // An older client may still send "intent"; it is ignored, and the stored value is carried through.
    await saveDiscoveryFilters(viewer, { ...BASE_FILTERS, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: "DATING" }, { db, now: T0 });
    const friend = await createUser(db, { now: T0, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: null });
    expect(await deck(viewer)).toContain(friend.userId);
    await saveDiscoveryFilters(viewer, { ...BASE_FILTERS, connectionIntent: "DATING", intent: null }, { db, now: T0 });
    expect((await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: viewer.userId } })).intent).toBe("MARRIAGE");
    const dater = await createUser(db, { now: T0, gender: "WOMAN", intent: "FIGURING_OUT" });
    expect(await deck(viewer)).toContain(dater.userId);
  });

  it("an empty Friendship deck is never blamed on a hidden Dating filter", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", lookingFor: "MARRIAGE" });
    await createUser(db, { now: T0, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: null });
    const page = await getDeck(viewer, {}, { db, storage, now: T0 });
    expect(page.cards).toHaveLength(1);
    expect(page.emptyReason).toBe("NONE");
  });
});

describe("Friendship cards never expose a stale Dating intent", () => {
  it("hides Profile.intent for Friendship members on every surface built from the visible profile, and keeps it for Dating", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    const friend = await createUser(db, { now: T0, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: "MARRIAGE" });
    const dater = await createUser(db, { now: T0, gender: "WOMAN", intent: "MARRIAGE" });
    const [f, d] = await buildVisibleProfiles(db, viewer.userId, [friend.userId, dater.userId], T0);
    expect(f?.intent).toBeNull();
    expect(d?.intent).toBe("MARRIAGE");

    const page = await getDeck(viewer, {}, { db, storage, now: T0 });
    expect(page.cards.map((c) => c.handle)).toEqual([friend.handle]);
    expect(page.cards[0]?.intent).toBeNull();
    expect(JSON.stringify(page)).not.toContain("MARRIAGE");
    // Stored, not deleted: it is theirs if they go back to Dating.
    expect((await db.profile.findUniqueOrThrow({ where: { userId: friend.userId } })).intent).toBe("MARRIAGE");
  });
});

describe("Edit profile follows the same rule", () => {
  it("a Friendship member saves About without a relationship intention, and a stored one is neither cleared nor overwritten", async () => {
    const me = await createUser(db, { now: T0, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: "FIGURING_OUT" });
    expect((await getEditProfileData(me, { db })).connectionIntent).toBe("FRIENDSHIP");
    await updateAbout(me, { bio: "Here for friends", interestIds: [], prompts: [] }, { db });
    await updateAbout(me, { bio: "Still here for friends", intent: "MARRIAGE", interestIds: [], prompts: [] }, { db });
    const profile = await db.profile.findUniqueOrThrow({ where: { userId: me.userId } });
    expect(profile.bio).toBe("Still here for friends");
    expect(profile.intent).toBe("FIGURING_OUT");
  });

  it("a Friendship member who never had one can save without one", async () => {
    const me = await createUser(db, { now: T0, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: null });
    await updateAbout(me, { bio: "Hi", intent: null, interestIds: [], prompts: [] }, { db });
    expect((await db.profile.findUniqueOrThrow({ where: { userId: me.userId } })).intent).toBeNull();
  });

  it("a Dating member still has to answer it", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN" });
    await expect(updateAbout(me, { bio: "Hi", interestIds: [], prompts: [] }, { db })).rejects.toBeInstanceOf(ValidationError);
    await updateAbout(me, { bio: "Hi", intent: "DATING", interestIds: [], prompts: [] }, { db });
    expect((await db.profile.findUniqueOrThrow({ where: { userId: me.userId } })).intent).toBe("DATING");
  });
});

describe("Friendship → Dating never needs a relationship-intention answer", () => {
  it("switches without one — and is discoverable at once — and records the answer when the sheet is given one", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: null });
    expect((await getDiscoveryFilters(me, { db, now: T0 })).hasDatingIntent).toBe(false);
    const switched = await saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "DATING" }, { db, now: T0 });
    expect(switched).toMatchObject({ connectionIntent: "DATING", hasDatingIntent: false });
    const man = await createUser(db, { now: T0, gender: "MAN", lookingFor: "MARRIAGE" });
    expect(await deck(man)).toContain(me.userId);
    expect(await deck(me)).toContain(man.userId);

    const after = await saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "DATING", myIntent: "SERIOUS_RELATIONSHIP" }, { db, now: T0 });
    expect(after).toMatchObject({ connectionIntent: "DATING", hasDatingIntent: true });
    expect((await db.profile.findUniqueOrThrow({ where: { userId: me.userId } })).intent).toBe("SERIOUS_RELATIONSHIP");
  });

  it("never lets the sheet overwrite an existing answer — that is Edit profile's job", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", intent: "MARRIAGE" });
    await saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "DATING", interestedIn: "MEN", intent: null, myIntent: "DATING" }, { db, now: T0 });
    expect((await db.profile.findUniqueOrThrow({ where: { userId: me.userId } })).intent).toBe("MARRIAGE");
  });
});

describe("stored 'Show me' values are kept, never asked for, never rewritten and never read by discovery", () => {
  it("saving filters without changing pool never rewrites a stored Show me, whatever the request carries", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "MEN", friendshipInterestedIn: "MEN" });
    await saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" }, { db, now: T0 });
    expect(await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: me.userId }, select: { interestedIn: true, friendshipInterestedIn: true } })).toEqual({ interestedIn: "MEN", friendshipInterestedIn: "MEN" });
  });

  it("Dating → Friendship → Dating keeps the remembered Friendship answer, and the deck follows the pool alone", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", connectionIntent: "FRIENDSHIP", interestedIn: "MEN", friendshipInterestedIn: "MEN", intent: "DATING" });
    const friendWoman = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN" });
    const datingWoman = await createUser(db, { now: T0, gender: "WOMAN" });
    // A stored "Men" does not stop him seeing a Friendship woman: Friendship has no gender rule.
    expect(await deck(me)).toEqual([friendWoman.userId]);
    await saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "DATING" }, { db, now: T0 });
    expect(await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: me.userId }, select: { interestedIn: true, friendshipInterestedIn: true } })).toEqual({ interestedIn: "MEN", friendshipInterestedIn: "MEN" });
    // …and the stored "Men" does not stop him seeing a Dating woman either: Dating is opposite gender, by rule.
    expect(await deck(me)).toEqual([datingWoman.userId]);
    await saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "FRIENDSHIP" }, { db, now: T0 });
    expect((await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: me.userId } })).friendshipInterestedIn).toBe("MEN");
    expect(await deck(me)).toEqual([friendWoman.userId]);
  });
});

describe("age is one-way: my range decides who I see, never who can see me", () => {
  for (const mode of ["DATING", "FRIENDSHIP"] as const) {
    const showMe = (g: "MAN" | "WOMAN") => (mode === "DATING" ? (g === "MAN" ? "WOMEN" : "MEN") : "EVERYONE");

    it(`${mode}: a 27-year-old whose own range is 40–60 is still shown to a 25-year-old looking for 18–30`, async () => {
      const viewer = await createUser(db, { now: T0, gender: "MAN", age: 25, connectionIntent: mode, interestedIn: showMe("MAN"), ageMin: 18, ageMax: 30 });
      const cand = await createUser(db, { now: T0, gender: "WOMAN", age: 27, connectionIntent: mode, interestedIn: showMe("WOMAN"), ageMin: 40, ageMax: 60 });
      expect(await deck(viewer)).toContain(cand.userId);
      expect(await isDeckCandidate(db, viewer, cand.userId, T0)).toBe(true);
      // Her 40–60 still governs HER deck: he is 25, so she does not see him.
      expect(await deck(cand)).not.toContain(viewer.userId);
      // And that is her own filter, so her empty deck says FILTERS, not "nobody is here".
      expect(await countRelaxedCandidates(db, cand, T0)).toBe(1);
    });

    it(`${mode}: a 35-year-old is not shown to a viewer looking for 18–30`, async () => {
      const viewer = await createUser(db, { now: T0, gender: "MAN", age: 25, connectionIntent: mode, interestedIn: showMe("MAN"), ageMin: 18, ageMax: 30 });
      const cand = await createUser(db, { now: T0, gender: "WOMAN", age: 35, connectionIntent: mode, interestedIn: showMe("WOMAN"), ageMin: 18, ageMax: 60 });
      expect(await deck(viewer)).not.toContain(cand.userId);
      expect(await isDeckCandidate(db, viewer, cand.userId, T0)).toBe(false);
      // …while she, 18–60, does see him.
      expect(await deck(cand)).toContain(viewer.userId);
    });
  }

  it("a collapsed range (60–60, saved by the old slider) hides nobody from anybody else — it only narrows that member's own deck", async () => {
    const collapsed = await createUser(db, { now: T0, gender: "WOMAN", age: 26, ageMin: 60, ageMax: 60 });
    const men = await Promise.all([22, 34, 48].map((age) => createUser(db, { now: T0, gender: "MAN", age })));
    for (const m of men) expect(await deck(m)).toContain(collapsed.userId);
    expect(await deck(collapsed)).toEqual([]);
    // The stored row is exactly what it was: nothing rewrites it.
    expect(await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: collapsed.userId }, select: { ageMin: true, ageMax: true } })).toEqual({ ageMin: 60, ageMax: 60 });
  });

  it("no visibility query reads the candidate's age range", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", age: 30 });
    const v = await loadViewerContext(db, viewer.userId, T0);
    const text = compatibilitySql(v).sql + baseVisibleSql(v.userId, null, T0).sql + discoverableSql().sql + viewerFilterSql(v, T0).sql + notSwipedSql(v.userId, T0).sql;
    expect(text).not.toMatch(/cp\."ageMin"|cp\."ageMax"/);
    // The only age comparison left is the viewer's own range applied to the candidate's age.
    expect(viewerFilterSql(v, T0).sql).toMatch(/u\."dateOfBirth"/);
  });

  it("likes are unaffected: a like from someone whose range leaves me out still reaches Likes You", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", age: 29, ageMin: 18, ageMax: 60 });
    const fan = await createUser(db, { now: T0, gender: "MAN", age: 45, ageMin: 40, ageMax: 60 });
    await likeUser(fan, me.userId, { db, now: T0 });
    expect(await countEligibleIncomingLikes(db, me.userId, T0)).toBe(1);
  });
});

describe("the age range can't be saved collapsed", () => {
  it("refuses 60–60 and 34–34 and anything narrower than 3 years, whatever the client sends", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", age: 30 });
    for (const [ageMin, ageMax] of [[60, 60], [34, 34], [58, 60], [18, 20]] as const) {
      await expect(saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "DATING", interestedIn: "WOMEN", intent: null, ageMin, ageMax }, { db, now: T0 })).rejects.toThrow(/at least 3 years/);
    }
    expect(await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: me.userId }, select: { ageMin: true, ageMax: true } })).toEqual({ ageMin: 18, ageMax: 99 });
  });

  it("saves the narrowest allowed ranges at both bounds, and normal ranges, exactly as chosen", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", age: 30 });
    for (const [ageMin, ageMax] of [[57, 60], [18, 21], [18, 30], [25, 40]] as const) {
      const saved = await saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "DATING", interestedIn: "WOMEN", intent: null, ageMin, ageMax }, { db, now: T0 });
      expect({ ageMin: saved.ageMin, ageMax: saved.ageMax }).toEqual({ ageMin, ageMax });
    }
  });

  it("a range that leaves out the member's own age is saved as chosen — the server never corrects it", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", age: 25 });
    const saved = await saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "DATING", interestedIn: "WOMEN", intent: null, ageMin: 40, ageMax: 60 }, { db, now: T0 });
    expect({ ageMin: saved.ageMin, ageMax: saved.ageMax, ownAge: saved.ownAge }).toEqual({ ageMin: 40, ageMax: 60, ownAge: 25 });
  });

  it("a member already stored at 60–60 is read back untouched, and can save once they widen it", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", age: 26, ageMin: 60, ageMax: 60 });
    expect(await getDiscoveryFilters(me, { db, now: T0 })).toMatchObject({ ageMin: 60, ageMax: 60 });
    const saved = await saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "DATING", interestedIn: "MEN", intent: null, ageMin: 57, ageMax: 60 }, { db, now: T0 });
    expect({ ageMin: saved.ageMin, ageMax: saved.ageMax }).toEqual({ ageMin: 57, ageMax: 60 });
  });
});

describe("18–60 is the one canonical default", () => {
  it("every source agrees: config, the row a new account gets, the onboarding upserts, the filters default, the no-row fallback and the database column", async () => {
    expect(DISCOVERY.defaultAgeRange).toEqual({ min: DISCOVERY.filterAgeMin, max: DISCOVERY.filterAgeMax });
    expect(DEFAULT_AGE_PREFERENCES).toEqual({ ageMin: 18, ageMax: 60 });
    expect({ ageMin: DEFAULT_FILTERS.ageMin, ageMax: DEFAULT_FILTERS.ageMax }).toEqual(DEFAULT_AGE_PREFERENCES);

    const account = await createAccount(db, T0);
    expect(await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: account.id }, select: { ageMin: true, ageMax: true } })).toEqual(DEFAULT_AGE_PREFERENCES);

    // The onboarding CONNECTION step creates the row when it is missing: with the default range, not the column's.
    await db.discoveryPreferences.delete({ where: { userId: account.id } });
    await saveName({ userId: account.id }, { name: "New" }, { db });
    await saveGender({ userId: account.id }, { gender: "MAN" }, { db });
    await saveConnectionIntent({ userId: account.id }, { connectionIntent: "DATING" }, { db });
    expect(await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: account.id }, select: { ageMin: true, ageMax: true } })).toEqual(DEFAULT_AGE_PREFERENCES);

    // No row at all: the viewer context falls back to the same range.
    await db.discoveryPreferences.delete({ where: { userId: account.id } });
    const v = await loadViewerContext(db, account.id, T0);
    expect({ ageMin: v.ageMin, ageMax: v.ageMax }).toEqual(DEFAULT_AGE_PREFERENCES);

    // And the database's own column default, which the migration pins to the same numbers.
    const cols = await db.$queryRaw<{ column_name: string; column_default: string }[]>(Prisma.sql`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'DiscoveryPreferences' AND column_name IN ('ageMin', 'ageMax')`);
    expect(Object.fromEntries(cols.map((c) => [c.column_name, Number(c.column_default)]))).toEqual(DEFAULT_AGE_PREFERENCES);
  });

  it("two members who walk the Friendship onboarding path, aged 31 and 36, see each other with the defaults they were given", async () => {
    const loc = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const onboard = async (name: string, gender: "MAN" | "WOMAN", year: number) => {
      const account = await createAccount(db, T0);
      const actor = { userId: account.id };
      await saveName(actor, { name }, { db });
      await saveDateOfBirth(actor, { day: 1, month: 1, year }, { db, now: T0 });
      await saveGender(actor, { gender }, { db });
      await saveConnectionIntent(actor, { connectionIntent: "FRIENDSHIP" }, { db });
      await saveLocation(actor, { locationId: loc.id }, { db });
      const profile = await db.profile.findUniqueOrThrow({ where: { userId: actor.userId } });
      for (const i of [0, 1]) {
        await db.profilePhoto.create({ data: { profileId: profile.id, position: i, storageKey: `t/${name}/${i}`, thumbKey: `t/${name}/${i}t`, blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH", width: 1080, height: 1440, moderation: "APPROVED" } });
      }
      await confirmPhotos(actor, { db });
      await saveAbout(actor, { bio: "", interestIds: [], prompts: [] }, { db });
      await savePrivacy(actor, { hideLocation: false, hideAge: false }, { db });
      await completeOnboarding(actor, { db, now: T0 });
      return actor;
    };
    const a = await onboard("Thirty-one", "MAN", 1995);
    const b = await onboard("Thirty-six", "WOMAN", 1990);
    expect(await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: a.userId }, select: { ageMin: true, ageMax: true } })).toEqual(DEFAULT_AGE_PREFERENCES);
    expect(await getDeckCandidateIds(db, a, { now: T0 })).toContain(b.userId);
    expect(await getDeckCandidateIds(db, b, { now: T0 })).toContain(a.userId);
  });
});

describe("Prefer not to say cannot be stranded on Dating", () => {
  it("the sheet's Dating switch is refused with an explanation, and the DTO says so up front", async () => {
    const me = await createUser(db, { now: T0, gender: "UNSPECIFIED", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    expect((await getDiscoveryFilters(me, { db, now: T0 })).canDate).toBe(false);
    await expect(saveDiscoveryFilters(me, { ...BASE_FILTERS, connectionIntent: "DATING", interestedIn: "EVERYONE", intent: null, myIntent: "DATING" }, { db, now: T0 })).rejects.toThrow("needs Woman or Man");
    expect((await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: me.userId } })).connectionIntent).toBe("FRIENDSHIP");
  });

  it("nobody can newly choose Prefer not to say in Edit profile (2026-09-26), in either pool", async () => {
    const loc = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    for (const connectionIntent of ["DATING", "FRIENDSHIP"] as const) {
      const member = await createUser(db, { now: T0, gender: "MAN", connectionIntent, interestedIn: "EVERYONE" });
      await expect(updateInfo(member, { gender: "UNSPECIFIED", locationId: loc.id }, { db })).rejects.toThrow("Choose Woman or Man");
      expect((await db.user.findUniqueOrThrow({ where: { id: member.userId } })).gender).toBe("MAN");
    }
  });

  it("a member already in that state (it predates the rule) is not rewritten and can still save the rest of their Info", async () => {
    const loc = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const legacy = await createUser(db, { now: T0, gender: "UNSPECIFIED", interestedIn: "WOMEN" });
    await updateInfo(legacy, { gender: "UNSPECIFIED", locationId: loc.id, occupation: "Teacher" }, { db });
    expect(await db.profile.findUniqueOrThrow({ where: { userId: legacy.userId }, select: { occupation: true } })).toEqual({ occupation: "Teacher" });
    expect(await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: legacy.userId }, select: { connectionIntent: true, interestedIn: true } })).toEqual({ connectionIntent: "DATING", interestedIn: "WOMEN" });
    expect((await getDiscoveryFilters(legacy, { db, now: T0 })).canDate).toBe(false);
  });

  it("onboarding: a new member chooses Woman or Man — Prefer not to say is refused at the GENDER step", async () => {
    const account = await createAccount(db, T0);
    const actor = { userId: account.id };
    await saveName(actor, { name: "Xan" }, { db });
    await expect(saveGender(actor, { gender: "UNSPECIFIED" }, { db })).rejects.toThrow("Choose Woman or Man");
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.userId } })).gender).toBeNull();
    await saveGender(actor, { gender: "MAN" }, { db });
    await saveConnectionIntent(actor, { connectionIntent: "DATING" }, { db });
    await expect(saveGender(actor, { gender: "UNSPECIFIED" }, { db })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a member mid-onboarding who already holds Prefer not to say keeps it and can re-save it (never changed for them)", async () => {
    const account = await createAccount(db, T0);
    const actor = { userId: account.id };
    await saveName(actor, { name: "Legacy" }, { db });
    await db.user.update({ where: { id: actor.userId }, data: { gender: "UNSPECIFIED" } });
    await saveGender(actor, { gender: "UNSPECIFIED" }, { db });
    await expect(saveConnectionIntent(actor, { connectionIntent: "DATING" }, { db })).rejects.toBeInstanceOf(ValidationError);
    await saveConnectionIntent(actor, { connectionIntent: "FRIENDSHIP" }, { db });
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.userId } })).gender).toBe("UNSPECIFIED");
  });
});

describe("specific atoll selection", () => {
  it("an atoll matches every island and city in it; an island matches only itself", async () => {
    const atoll = await db.location.create({ data: { slug: "atoll-lh", name: "Lh. Atoll", kind: "ATOLL", atollCode: "Lh", atollName: "Faadhippolhu" } });
    const naifaru = await db.location.create({ data: { slug: "naifaru", name: "Naifaru", kind: "ISLAND", atollCode: "Lh", atollName: "Faadhippolhu" } });
    const hinnavaru = await db.location.create({ data: { slug: "hinnavaru", name: "Hinnavaru", kind: "ISLAND", atollCode: "Lh", atollName: "Faadhippolhu" } });
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const onAtollRow = await createUser(db, { now: T0, gender: "WOMAN", locationId: atoll.id });
    const onNaifaru = await createUser(db, { now: T0, gender: "WOMAN", locationId: naifaru.id });
    const onHinnavaru = await createUser(db, { now: T0, gender: "WOMAN", locationId: hinnavaru.id });
    const inMale = await createUser(db, { now: T0, gender: "WOMAN", locationId: male.id });

    const atollViewer = await createUser(db, { now: T0, gender: "MAN", locationScope: "SPECIFIC", prefLocationId: atoll.id });
    const atollDeck = await deck(atollViewer);
    expect(atollDeck).toEqual(expect.arrayContaining([onAtollRow.userId, onNaifaru.userId, onHinnavaru.userId]));
    expect(atollDeck).not.toContain(inMale.userId);

    const islandViewer = await createUser(db, { now: T0, gender: "MAN", locationScope: "SPECIFIC", prefLocationId: naifaru.id });
    expect(await deck(islandViewer)).toEqual([onNaifaru.userId]);
  });
});

describe("likes respect pools", () => {
  it("a new like across pools is refused server-side, consumes nothing and creates nothing", async () => {
    const dater = await createUser(db, { now: T0, gender: "MAN" });
    const friend = await createUser(db, { now: T0, gender: "WOMAN", connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE" });
    await expect(likeUser(dater, friend.userId, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(likeUser(friend, dater.userId, { db, now: T0 })).rejects.toThrow(CROSS_POOL_LIKE);
    expect(await db.like.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
    expect(await db.usageCounter.count({ where: { used: { gt: 0 } } })).toBe(0);
  });

  it("an existing match and its conversation survive either member changing pools", async () => {
    const a = await createUser(db, { now: T0, gender: "MAN" });
    const b = await createUser(db, { now: T0, gender: "WOMAN" });
    await likeUser(a, b.userId, { db, now: T0 });
    const matched = await likeUser(b, a.userId, { db, now: T0 });
    expect(matched.matched).toBe(true);
    await db.discoveryPreferences.update({ where: { userId: b.userId }, data: { connectionIntent: "FRIENDSHIP", friendshipInterestedIn: "EVERYONE", interestedIn: "EVERYONE" } });
    expect(await db.match.count()).toBe(1);
    expect(await db.like.count()).toBe(2);
    const chats = await listConversations(a, { db, storage, now: T0 });
    expect(chats.newMatches.length + chats.conversations.length).toBe(1);
  });

  it("Likes You shows a like only while both are in the same pool; the like itself is kept and comes back", async () => {
    const liker = await createUser(db, { now: T0, gender: "MAN" });
    const me = await createUser(db, { now: T0, gender: "WOMAN" });
    await likeUser(liker, me.userId, { db, now: T0 });
    expect(await countEligibleIncomingLikes(db, me.userId, T0)).toBe(1);

    await db.discoveryPreferences.update({ where: { userId: liker.userId }, data: { connectionIntent: "FRIENDSHIP", friendshipInterestedIn: "EVERYONE", interestedIn: "EVERYONE" } });
    expect(await countEligibleIncomingLikes(db, me.userId, T0)).toBe(0);
    expect(await listEligibleIncomingLikes(db, me.userId, T0)).toEqual([]);
    expect(await db.like.count()).toBe(1);

    await db.discoveryPreferences.update({ where: { userId: me.userId }, data: { connectionIntent: "FRIENDSHIP", friendshipInterestedIn: "EVERYONE", interestedIn: "EVERYONE" } });
    expect(await countEligibleIncomingLikes(db, me.userId, T0)).toBe(1);
  });
});

describe("the empty-deck reason", () => {
  it("FILTERS when the viewer's own filters hide compatible people", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN", age: 30, ageMin: 18, ageMax: 25 });
    await createUser(db, { now: T0, gender: "WOMAN", age: 40 });
    expect((await getDeck(viewer, {}, { db, storage, now: T0 })).emptyReason).toBe("FILTERS");
  });

  it("EXHAUSTED only when the viewer has acted on everybody compatible", async () => {
    const viewer = await createUser(db, { now: T0, gender: "MAN" });
    const only = await createUser(db, { now: T0, gender: "WOMAN" });
    await likeUser(viewer, only.userId, { db, now: T0 });
    expect((await getDeck(viewer, {}, { db, storage, now: T0 })).emptyReason).toBe("EXHAUSTED");
  });

  it("UNAVAILABLE when nobody compatible is here, which it never names — and someone else's age range is never the reason", async () => {
    // The Zen/Nabu shape: different pools, and her age range leaves him out. Only the pool matters to him.
    const zen = await createUser(db, { now: T0, gender: "MAN", age: 31, connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN", ageMin: 18, ageMax: 37, intent: "FIGURING_OUT" });
    const nabu = await createUser(db, { now: T0, gender: "WOMAN", age: 36, interestedIn: "MEN", friendshipInterestedIn: "MEN", ageMin: 35, ageMax: 40, intent: "MARRIAGE" });
    const page = await getDeck(zen, {}, { db, storage, now: T0 });
    expect(page.cards).toEqual([]);
    expect(page.emptyReason).toBe("UNAVAILABLE");
    expect(await countRelaxedCandidates(db, zen, T0)).toBe(0);
    const json = JSON.stringify(page);
    expect(json).not.toContain(nabu.handle);
    expect(json).not.toMatch(/ageMin|ageMax|connectionIntent|interestedIn/);

    // Same pool: he sees her straight away. Her 35–40 leaves him (31) out, but age is one-way — her range decides
    // who she sees, and it never hides her from him.
    await db.discoveryPreferences.update({ where: { userId: nabu.userId }, data: { connectionIntent: "FRIENDSHIP", interestedIn: "MEN" } });
    expect(await deck(zen)).toEqual([nabu.userId]);
    // Her deck is where her range applies: he is outside it, and that is her own filter.
    const hers = await getDeck(nabu, {}, { db, storage, now: T0 });
    expect(hers.cards).toEqual([]);
    expect(hers.emptyReason).toBe("FILTERS");
    // Once her range includes him, they see each other.
    await db.discoveryPreferences.update({ where: { userId: nabu.userId }, data: { ageMin: 30 } });
    expect(await deck(nabu)).toEqual([zen.userId]);
  });
});

describe("admin: read-only discovery preferences", () => {
  it("shows the pool, both Show me values, the age range, scope, and Looking for only on Dating", async () => {
    const staff = await createStaff(db, { now: T0 });
    const admin = { userId: staff.userId, role: "ADMIN" as const };
    const friend = await createUser(db, { now: T0, age: 31, connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN", lookingFor: "MARRIAGE", ageMin: 35, ageMax: 40 });
    const f = await getUserDetail(admin, friend.userId, { db, now: T0 });
    expect(f.discovery).toMatchObject({ connectionIntent: "FRIENDSHIP", showMe: "WOMEN", friendshipShowMe: "WOMEN", ageMin: 35, ageMax: 40, ownAgeOutsideRange: true, locationScope: "ANYWHERE", datingLookingFor: null });
    const dater = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", lookingFor: "MARRIAGE" });
    expect((await getUserDetail(admin, dater.userId, { db, now: T0 })).discovery).toMatchObject({ connectionIntent: "DATING", datingLookingFor: "MARRIAGE" });
  });
});

describe("qa-cohort's visibility SQL agrees with the real deck query", () => {
  it("pair for pair, across pools, intents, age ranges, scopes and swipes", async () => {
    const atoll = await db.location.create({ data: { slug: "atoll-b", name: "B. Atoll", kind: "ATOLL", atollCode: "B", atollName: "Baa" } });
    const eydhafushi = await db.location.create({ data: { slug: "eydhafushi", name: "Eydhafushi", kind: "ISLAND", atollCode: "B", atollName: "Baa" } });
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const users = [
      await createUser(db, { now: T0, gender: "MAN", age: 31, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", lookingFor: "MARRIAGE", locationId: male.id }),
      await createUser(db, { now: T0, gender: "WOMAN", age: 36, connectionIntent: "FRIENDSHIP", interestedIn: "MEN", intent: null, locationId: eydhafushi.id }),
      await createUser(db, { now: T0, gender: "WOMAN", age: 29, connectionIntent: "FRIENDSHIP", interestedIn: "WOMEN", ageMin: 25, ageMax: 35, locationId: male.id }),
      await createUser(db, { now: T0, gender: "UNSPECIFIED", age: 40, connectionIntent: "FRIENDSHIP", interestedIn: "EVERYONE", locationId: male.id }),
      await createUser(db, { now: T0, gender: "MAN", age: 33, lookingFor: "MARRIAGE", locationScope: "SPECIFIC", prefLocationId: atoll.id, locationId: male.id }),
      await createUser(db, { now: T0, gender: "WOMAN", age: 30, intent: "MARRIAGE", locationId: eydhafushi.id }),
      await createUser(db, { now: T0, gender: "WOMAN", age: 45, intent: "DATING", locationId: eydhafushi.id, ageMin: 40, ageMax: 60 }),
      await createUser(db, { now: T0, gender: "MAN", age: 24, locationScope: "GREATER_MALE", locationId: eydhafushi.id }),
      await createUser(db, { now: T0, gender: "WOMAN", age: 26, locationId: male.id, photos: 1 }),
    ];
    await likeUser(users[7]!, users[5]!.userId, { db, now: T0 });

    const handles = new Map(users.map((u) => [u.userId, u.handle]));
    const rows = await db.$queryRawUnsafe<{ viewer: string; deck: string }[]>(
      visibilityMatrixSql(`WITH cohort AS (SELECT u.id, p.handle FROM "User" u JOIN "Profile" p ON p."userId" = u.id)`),
    );
    const sqlDecks = new Map(rows.map((r) => [r.viewer, r.deck === "(empty deck)" ? [] : r.deck.split(" ")]));
    for (const u of users) {
      // The matrix computes ages with the database clock, so the real query runs at "now" too.
      const real = (await getDeckCandidateIds(db, u, { limit: 30 })).map((id) => handles.get(id)!).sort();
      expect({ viewer: u.handle, deck: sqlDecks.get(u.handle) ?? [] }).toEqual({ viewer: u.handle, deck: real });
    }
  });
});

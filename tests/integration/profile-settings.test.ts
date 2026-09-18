import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PHOTO_LIMITS } from "@/config/product";
import { resetEnvCache } from "@/lib/env";
import { EntitlementRequiredError, InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { infoSchema } from "@/lib/validation/profile";
import { recordReauthentication } from "@/server/auth/identity";
import { createSession, resolveSession, revokeSession } from "@/server/auth/session";
import { getFeed } from "@/server/community/feed";
import { createPost } from "@/server/community/posts";
import { getConversationForActor, sendMessage } from "@/server/conversations/messages";
import { buildDiscoveryCards } from "@/server/discovery/dto";
import { getDeck } from "@/server/discovery/deck";
import { getDiscoveryFilters, saveDiscoveryFilters } from "@/server/discovery/filters";
import { canView, getDeckCandidateIds } from "@/server/discovery/query";
import { getMembership } from "@/server/entitlements/presentation";
import { likeUser } from "@/server/likes/like";
import { getNotificationSettings, updateNotificationSettings } from "@/server/notifications/settings";
import { deletePhoto, listPhotos, processAndStorePhoto, reorderPhotos } from "@/server/photos/photos";
import { addContactHashes, clearContactHashes } from "@/server/privacy/contact-hashes";
import { getInvisibleModeState, setInvisibleMode } from "@/server/privacy/invisible-mode";
import { getPrivacySettings, setDatingPaused, updatePrivacyToggles } from "@/server/privacy/settings";
import { getEditProfileData, updateAbout, updateInfo } from "@/server/profiles/edit";
import { getMyProfileSummary } from "@/server/profiles/me";
import { buildVisibleProfiles } from "@/server/profiles/visible-profile";
import { blockUser } from "@/server/safety/block";
import { listBlockedUsers, unblockUser } from "@/server/safety/blocked";
import { deleteAccount } from "@/server/users/deletion";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createIdentity, createLocation, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));

async function fixtures() {
  const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
  const addu = await createLocation(db, { name: "Addu City", atollCode: "S" });
  const interests = await Promise.all(["Diving", "Coffee", "Music", "Art"].map((label) => db.interest.create({ data: { slug: `${label.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`, label } })));
  const prompt = await db.prompt.create({ data: { slug: `p-${Math.random().toString(36).slice(2, 8)}`, text: "My perfect weekend..." } });
  return { male, addu, interests, prompt };
}

async function matchPair(a: TestUser, b: TestUser, now = T0) {
  await likeUser(a, b.userId, { db, now });
  const r = await likeUser(b, a.userId, { db, now });
  if (!r.matched || !r.conversationId) throw new Error("expected a match");
  return r.conversationId;
}

beforeEach(() => resetDb(db));
afterEach(() => {
  delete process.env.PHOTO_VISIBILITY_POLICY;
  resetEnvCache();
});
afterAll(() => disconnectDb());

describe("own profile and editing", () => {
  it("loads the owner's data (including their own DOB) and never someone else's", async () => {
    const me = await createUser(db, { now: T0, name: "Ismail", age: 27 });
    const data = await getEditProfileData(me, { db });
    expect(data.name).toBe("Ismail");
    expect(data.age).toBe(27);
    expect(data.dob?.year).toBe(T0.getUTCFullYear() - 27);
    const summary = await getMyProfileSummary(me, { db, now: T0 });
    expect(summary).toMatchObject({ name: "Ismail", age: 27, tier: "FREE", likesGiven: 0, activeMatches: 0, verificationStatus: "NONE" });
    expect(JSON.stringify(summary)).not.toMatch(/phoneE164|phoneHash|dateOfBirth|"dob"/i);
  });

  it("persists a valid Info edit for the session user only; a forged user id in the payload is ignored", async () => {
    const { male, addu } = await fixtures();
    const me = await createUser(db, { now: T0, gender: "MAN" });
    const other = await createUser(db, { now: T0, gender: "MAN", locationId: male.id });
    await updateInfo(me, { gender: "UNSPECIFIED", locationId: addu.id, homeLocationId: male.id, occupation: "Product Designer", education: "Villa College", heightCm: 178, userId: other.userId, name: "Hacked", dateOfBirth: "2015-01-01" }, { db });
    const mine = await getEditProfileData(me, { db });
    expect(mine).toMatchObject({ gender: "UNSPECIFIED", locationName: "Addu City", homeLocationName: "Malé", occupation: "Product Designer", education: "Villa College", heightCm: 178 });
    expect(mine.name).not.toBe("Hacked");
    expect(mine.age).toBe(27); // DOB untouched: it is not an editable field
    const theirs = await getEditProfileData(other, { db });
    expect(theirs.occupation).toBe("");
    expect(theirs.locationName).toBe("Malé");
  });

  it("rejects invalid edits and strips unknown fields at the schema", async () => {
    const { male } = await fixtures();
    const me = await createUser(db, { now: T0 });
    await expect(updateInfo(me, { gender: "MAN", locationId: "nope", occupation: "x" }, { db })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateInfo(me, { gender: "MAN", locationId: male.id, occupation: "<b>bold</b>" }, { db })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateInfo(me, { gender: "MAN", locationId: male.id, heightCm: 90 }, { db })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateInfo(me, { gender: "ROBOT", locationId: male.id }, { db })).rejects.toBeInstanceOf(ValidationError);
    const parsed = infoSchema.parse({ gender: "MAN", locationId: male.id, dob: { day: 1, month: 1, year: 2015 }, role: "ADMIN", status: "SUSPENDED" });
    expect(Object.keys(parsed).sort()).toEqual(["education", "gender", "heightCm", "homeLocationId", "locationId", "occupation"]);
  });

  it("About edits reuse the onboarding rules and recalculate completion", async () => {
    const { male, interests, prompt } = await fixtures();
    const me = await createUser(db, { now: T0, locationId: male.id });
    await db.profile.update({ where: { userId: me.userId }, data: { bio: null } });
    const before = (await getEditProfileData(me, { db })).completion.percent;
    await expect(updateAbout(me, { bio: "hi", intent: "DATING", interestIds: ["bogus"], prompts: [] }, { db })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateAbout(me, { bio: "<script>", intent: "DATING", interestIds: [], prompts: [] }, { db })).rejects.toBeInstanceOf(ValidationError);
    await updateAbout(me, { bio: "Designing in Malé.", intent: "DATING", interestIds: interests.slice(0, 3).map((i) => i.id), prompts: [{ promptId: prompt.id, answer: "Ferry, book, no signal." }] }, { db });
    const after = await getEditProfileData(me, { db });
    expect(after.intent).toBe("DATING");
    expect(after.interestIds).toHaveLength(3);
    expect(after.prompts).toEqual([{ promptId: prompt.id, answer: "Ferry, book, no signal." }]);
    expect(after.completion.percent).toBeGreaterThan(before);
    expect(after.completion.requiredComplete).toBe(true);
  });
});

describe("profile photos", () => {
  it("the owner can reorder and choose the main photo; foreign mutation is refused", async () => {
    const me = await createUser(db, { now: T0, photos: 3 });
    const other = await createUser(db, { now: T0, photos: 2 });
    const mine = await listPhotos(me, { db, storage });
    await reorderPhotos(me, [mine[2]!.id, mine[0]!.id, mine[1]!.id], { db });
    const after = await listPhotos(me, { db, storage });
    expect(after.map((p) => p.id)).toEqual([mine[2]!.id, mine[0]!.id, mine[1]!.id]);
    expect(after[0]!.isPrimary).toBe(true);
    await expect(reorderPhotos(other, [mine[0]!.id, mine[1]!.id, mine[2]!.id], { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deletePhoto(other, mine[0]!.id, { db, storage })).rejects.toBeInstanceOf(NotFoundError);
    expect(await listPhotos(me, { db, storage })).toHaveLength(3);
  });

  it("a completed profile cannot drop below the minimum, a rejected photo can always go, and onboarding is unaffected", async () => {
    const me = await createUser(db, { now: T0, photos: 3 });
    const photos = await listPhotos(me, { db, storage });
    await deletePhoto(me, photos[2]!.id, { db, storage });
    expect(await listPhotos(me, { db, storage })).toHaveLength(2);
    await expect(deletePhoto(me, photos[0]!.id, { db, storage })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(deletePhoto(me, photos[0]!.id, { db, storage })).rejects.toThrow(/at least 2/);
    expect(await listPhotos(me, { db, storage })).toHaveLength(PHOTO_LIMITS.min);
    // A rejected photo never counts and can be removed even at the minimum.
    await db.profilePhoto.update({ where: { id: photos[1]!.id }, data: { moderation: "REJECTED" } });
    const extra = await db.profilePhoto.create({ data: { profile: { connect: { userId: me.userId } }, position: 2, storageKey: `t/${me.handle}/x.webp`, thumbKey: `t/${me.handle}/x-t.webp`, blurhash: "L", width: 1080, height: 1440, moderation: "APPROVED" } });
    await deletePhoto(me, photos[1]!.id, { db, storage });
    expect((await listPhotos(me, { db, storage })).map((p) => p.id).sort()).toEqual([photos[0]!.id, extra.id].sort());
    // An onboarding account may remove freely; the completion gate enforces the minimum later.
    const newbie = await createUser(db, { now: T0, status: "ONBOARDING", photos: 2 });
    const theirs = await listPhotos(newbie, { db, storage });
    await deletePhoto(newbie, theirs[0]!.id, { db, storage });
    expect(await listPhotos(newbie, { db, storage })).toHaveLength(1);
  });

  it("keeps the maximum of six and the production photo policy", async () => {
    const me = await createUser(db, { now: T0, photos: 6 });
    await expect(processAndStorePhoto(me, { bytes: new Uint8Array(64), size: 64, declaredType: "image/jpeg" }, { db, storage, now: T0 })).rejects.toThrow(/up to 6/);
    const pending = await createUser(db, { now: T0, photos: 2, photoModeration: "PENDING" });
    const viewer = await createUser(db, { now: T0 });
    process.env.PHOTO_VISIBILITY_POLICY = "approved-only";
    resetEnvCache();
    const [profile] = await buildVisibleProfiles(db, viewer.userId, [pending.userId], T0);
    expect(profile?.photos).toHaveLength(0);
    // The owner still sees their own pending photos in the editor, marked as such.
    expect((await listPhotos(pending, { db, storage })).map((p) => p.moderation)).toEqual(["PENDING", "PENDING"]);
    delete process.env.PHOTO_VISIBILITY_POLICY;
    resetEnvCache();
    expect((await buildVisibleProfiles(db, viewer.userId, [pending.userId], T0))[0]?.photos).toHaveLength(2);
  });
});

describe("discovery settings", () => {
  it("persists basic preferences for Free users and discards premium fields they submit", async () => {
    const me = await createUser(db, { now: T0 });
    const saved = await saveDiscoveryFilters(me, { interestedIn: "WOMEN", ageMin: 24, ageMax: 31, locationScope: "GREATER_MALE", intent: "DATING", heightMinCm: 170, heightMaxCm: 190, education: "Villa" }, { db, now: T0 });
    expect(saved).toMatchObject({ interestedIn: "WOMEN", ageMin: 24, ageMax: 31, locationScope: "GREATER_MALE", intent: "DATING", advancedEnabled: false });
    const row = await db.discoveryPreferences.findUniqueOrThrow({ where: { userId: me.userId } });
    expect(row.heightMinCm).toBeNull();
    expect(row.education).toBeNull();
    expect((await getDiscoveryFilters(me, { db, now: T0 })).ageMin).toBe(24);
  });

  it("stores advanced filters for Plus users", async () => {
    const me = await createUser(db, { now: T0 });
    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const saved = await saveDiscoveryFilters(me, { interestedIn: "EVERYONE", ageMin: 22, ageMax: 34, locationScope: "ANYWHERE", heightMinCm: 165, heightMaxCm: 185, education: "MNU" }, { db, now: T0 });
    expect(saved).toMatchObject({ heightMinCm: 165, heightMaxCm: 185, education: "MNU", advancedEnabled: true });
  });
});

describe("privacy", () => {
  it("hide location and hide age persist and are absent from what other users receive", async () => {
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const me = await createUser(db, { now: T0, locationId: male.id, age: 29 });
    const viewer = await createUser(db, { now: T0 });
    let cards = await buildDiscoveryCards(db, viewer.userId, [me.userId], T0, storage);
    expect(cards[0]).toMatchObject({ location: "Malé", age: 29 });
    const updated = await updatePrivacyToggles(me, { hideLocation: true, hideAge: true, hideActiveStatus: true, invisibleMode: true, visibility: "HIDDEN" }, { db });
    expect(updated).toMatchObject({ hideLocation: true, hideAge: true, hideActiveStatus: true });
    expect(updated.invisibleMode.enabled).toBe(false); // not a toggle: goes through the entitlement-checked path
    expect(updated.paused).toBe(false);
    cards = await buildDiscoveryCards(db, viewer.userId, [me.userId], T0, storage);
    expect(cards[0]).toMatchObject({ location: null, age: null, isActiveNow: null });
    // The owner still sees their own location and age.
    const own = await getEditProfileData(me, { db });
    expect(own.locationName).toBe("Malé");
    expect(own.age).toBe(29);
    expect(JSON.stringify(cards)).not.toMatch(/dateOfBirth|phone|hideAge|hideLocation/);
  });

  it("Invisible Mode: Free refused, Plus accepted, fail-closed on expiry, matches and Community unaffected", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN", ageMin: 20, ageMax: 40 });
    const partner = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40 });
    const stranger = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40 });
    const conv = await matchPair(me, partner);
    await expect(setInvisibleMode(me, true, { db, now: T0 })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect((await getPrivacySettings(me, { db, now: T0 })).invisibleMode).toEqual({ enabled: false, effective: false, suspended: false, available: false });

    await grantPlus(db, me.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await setInvisibleMode(me, true, { db, now: T0 });
    expect((await getPrivacySettings(me, { db, now: T0 })).invisibleMode).toEqual({ enabled: true, effective: true, suspended: false, available: true });
    expect(await canView(db, stranger.userId, me.userId, T0)).toBe(false);
    // Existing match and chat keep working.
    expect(await getConversationForActor(db, partner, conv)).toBeTruthy();
    expect((await sendMessage(partner, conv, "Still here", { db, now: at(T0, minutes(1)) })).body).toBe("Still here");
    // Community unaffected: posts are visible to the stranger under Community rules.
    const post = await createPost(me, { kind: "TEXT", body: "Community post while invisible" }, { db, storage, now: at(T0, minutes(2)) });
    expect((await getFeed(stranger, {}, { db, storage, now: at(T0, minutes(3)) })).posts.map((p) => p.id)).toContain(post.id);
    expect(await getDeckCandidateIds(db, stranger, { now: at(T0, minutes(3)) })).not.toContain(me.userId);

    // Plus lapses: still hidden, state reported as suspended, nothing exposed.
    const later = at(T0, hours(48));
    expect(await getInvisibleModeState(me, { db, now: later })).toEqual({ enabled: true, effective: false, suspended: true });
    expect(await canView(db, stranger.userId, me.userId, later)).toBe(false);
    expect(await getConversationForActor(db, me, conv)).toBeTruthy();
    // Turning it off restores normal discovery.
    await setInvisibleMode(me, false, { db, now: later });
    expect(await canView(db, stranger.userId, me.userId, later)).toBe(true);
  });

  it("Pause Dating hides the user from Discover, blocks new likes, keeps chats and can be resumed", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN", ageMin: 20, ageMax: 40 });
    const partner = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40 });
    const stranger = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40 });
    const conv = await matchPair(me, partner);
    const paused = await setDatingPaused(me, true, { db, now: T0 });
    expect(paused).toMatchObject({ paused: true, visibility: "HIDDEN" });
    expect(await getDeckCandidateIds(db, stranger, { now: T0 })).not.toContain(me.userId);
    expect((await getDeck(me, {}, { db, storage, now: T0 })).emptyReason).toBe("PAUSED");
    await expect(likeUser(me, stranger.userId, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    expect((await sendMessage(me, conv, "Paused but chatting", { db, now: at(T0, minutes(1)) })).body).toBe("Paused but chatting");
    const resumed = await setDatingPaused(me, false, { db, now: at(T0, minutes(2)) });
    expect(resumed).toMatchObject({ paused: false, visibility: "EVERYONE" });
    expect(await getDeckCandidateIds(db, stranger, { now: at(T0, minutes(2)) })).toContain(me.userId);
  });

  it("contact hashes are stored as digests only, bounded, and cleared on request", async () => {
    const me = await createUser(db, { now: T0 });
    const hex = (n: number) => n.toString(16).padStart(64, "0");
    const r = await addContactHashes(me, { hashes: [hex(1), hex(2), hex(2)], source: "MANUAL" }, { db, now: T0 });
    expect(r).toEqual({ added: 2, total: 2 });
    await expect(addContactHashes(me, { hashes: ["not-hex"], source: "MANUAL" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    const rows = await db.contactHash.findMany({ where: { userId: me.userId } });
    expect(rows.every((row) => row.hash.byteLength === 32)).toBe(true);
    expect((await getPrivacySettings(me, { db, now: T0 })).contactHashCount).toBe(2);
    await clearContactHashes(me, { db });
    expect((await getPrivacySettings(me, { db, now: T0 })).contactHashCount).toBe(0);
  });
});

describe("blocked users", () => {
  it("lists my blocks, unblocks only my own block, and restores nothing", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN", ageMin: 20, ageMax: 40 });
    const target = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40, name: "Target" });
    const bystander = await createUser(db, { now: T0 });
    const conv = await matchPair(me, target);
    await blockUser(me, target.userId, { db, now: at(T0, minutes(1)) });
    const list = await listBlockedUsers(me, { db, storage });
    expect(list.map((b) => b.name)).toEqual(["Target"]);
    expect(JSON.stringify(list)).not.toMatch(/userId|phone|"id"/);
    // Only the blocker can remove it; a forged handle or another user achieves nothing.
    await expect(unblockUser(bystander, target.handle, { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(unblockUser(me, "no-such-handle", { db })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.block.count()).toBe(1);
    await unblockUser(me, target.handle, { db });
    expect(await listBlockedUsers(me, { db, storage })).toEqual([]);
    expect(await db.block.count()).toBe(0);
    // Nothing is restored: match stays BLOCKED, conversation LOCKED, likes gone, no notification to the target.
    expect((await db.match.findFirstOrThrow({ where: { OR: [{ userAId: me.userId }, { userBId: me.userId }] } })).status).toBe("BLOCKED");
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conv } })).status).toBe("LOCKED");
    expect(await db.like.count({ where: { OR: [{ fromUserId: me.userId }, { toUserId: me.userId }] } })).toBe(0);
    expect(await db.notification.count({ where: { userId: target.userId, createdAt: { gt: at(T0, minutes(1)) } } })).toBe(0);
    // Discovery follows the normal rules again.
    expect(await canView(db, target.userId, me.userId, at(T0, minutes(5)))).toBe(true);
  });
});

describe("notification settings", () => {
  it("persist, gate future notifications and leave history intact", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN", ageMin: 20, ageMax: 40 });
    const fan1 = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40 });
    const fan2 = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40 });
    await likeUser(fan1, me.userId, { db, now: T0 });
    expect(await db.notification.count({ where: { userId: me.userId, type: "LIKE_RECEIVED" } })).toBe(1);
    const settings = await updateNotificationSettings(me, { likes: false, community: true, role: "ADMIN" }, { db });
    expect(settings).toEqual({ matches: true, likes: false, messages: true, community: true, marketing: false });
    expect(await getNotificationSettings(me, { db })).toEqual(settings);
    await likeUser(fan2, me.userId, { db, now: at(T0, minutes(1)) });
    expect(await db.notification.count({ where: { userId: me.userId, type: "LIKE_RECEIVED" } })).toBe(1); // historical row kept, no new one
  });
});

describe("account: sessions, deletion", () => {
  it("logout revokes exactly the current session", async () => {
    const me = await createUser(db, { now: T0 });
    const a = await createSession(db, me.userId, {}, T0);
    const b = await createSession(db, me.userId, {}, T0);
    expect(await revokeSession(db, a.token)).toBe(true);
    expect(await resolveSession(db, a.token, at(T0, 1000))).toBeNull();
    expect((await resolveSession(db, b.token, at(T0, 1000)))?.user.id).toBe(me.userId);
  });

  it("deletion requires a recent Google re-authentication on the current session; a foreign or stale confirmation changes nothing", async () => {
    const me = await createUser(db, { now: T0 });
    const other = await createUser(db, { now: T0 });
    const mine = await createIdentity(db, me.userId);
    const theirs = await createIdentity(db, other.userId);
    const claims = (i: { subject: string; email: string }) => ({ subject: i.subject, email: i.email, emailVerified: true, name: null, authTime: null, issuedAt: T0 });
    const session = await createSession(db, me.userId, {}, T0);
    // An ordinary, even brand-new, session is not enough.
    expect(await deleteAccount(me, { sessionId: session.sessionId }, { db, storage, now: T0 })).toEqual({ ok: false, code: "REAUTH_REQUIRED" });
    // A confirmation by a different Google identity never marks my session.
    expect(await recordReauthentication(db, { sessionId: session.sessionId, userId: me.userId, claims: claims(theirs) }, T0)).toBe(false);
    expect(await deleteAccount(me, { sessionId: session.sessionId }, { db, storage, now: T0 })).toEqual({ ok: false, code: "REAUTH_REQUIRED" });
    // A confirmation older than the window is stale.
    expect(await recordReauthentication(db, { sessionId: session.sessionId, userId: me.userId, claims: claims(mine) }, T0)).toBe(true);
    expect(await deleteAccount(me, { sessionId: session.sessionId }, { db, storage, now: at(T0, minutes(6)) })).toEqual({ ok: false, code: "REAUTH_REQUIRED" });
    // Another session of mine does not inherit the mark.
    const second = await createSession(db, me.userId, {}, T0);
    await recordReauthentication(db, { sessionId: session.sessionId, userId: me.userId, claims: claims(mine) }, at(T0, minutes(7)));
    expect(await deleteAccount(me, { sessionId: second.sessionId }, { db, storage, now: at(T0, minutes(7)) })).toEqual({ ok: false, code: "REAUTH_REQUIRED" });
    expect((await db.user.findUniqueOrThrow({ where: { id: me.userId } })).status).toBe("ACTIVE");
  });

  it("deleting anonymises the account, ends sessions, matches and discovery, keeps safety evidence and releases the identity", async () => {
    const me = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN", ageMin: 20, ageMax: 40, name: "Leaving" });
    const partner = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40 });
    const reporter = await createUser(db, { now: T0 });
    const identity = await createIdentity(db, me.userId, { email: "leaving@example.com" });
    const conv = await matchPair(me, partner);
    await sendMessage(me, conv, "Hello there", { db, now: at(T0, minutes(1)) });
    const post = await createPost(me, { kind: "TEXT", body: "Bye" }, { db, storage, now: at(T0, minutes(2)) });
    await db.report.create({ data: { reporterId: reporter.userId, targetUserId: me.userId, reason: "SPAM", status: "OPEN" } });
    await blockUser(reporter, me.userId, { db, now: at(T0, minutes(3)) });
    const session = await createSession(db, me.userId, {}, T0);
    const phone = me.phoneE164;

    await recordReauthentication(db, { sessionId: session.sessionId, userId: me.userId, claims: { subject: identity.subject, email: identity.email, emailVerified: true, name: null, authTime: null, issuedAt: T0 } }, at(T0, minutes(4)));
    expect(await deleteAccount(me, { sessionId: session.sessionId }, { db, storage, now: at(T0, minutes(5)) })).toEqual({ ok: true });

    const user = await db.user.findUniqueOrThrow({ where: { id: me.userId }, include: { profile: { include: { photos: true } }, identities: true } });
    expect(user.status).toBe("DELETED");
    expect(user.deletedAt).not.toBeNull();
    expect(user.phoneE164).toBeNull();
    expect(user.dateOfBirth).toBeNull();
    expect(user.profile?.displayName).toBe("Deleted member");
    expect(user.profile?.photos).toHaveLength(0);
    expect(user.identities).toHaveLength(1);
    expect(user.identities[0]).toMatchObject({ email: "", displayName: null, providerSubject: identity.subject });
    expect(user.identities[0]!.releasedAt).not.toBeNull();
    expect(await resolveSession(db, session.token, at(T0, minutes(6)))).toBeNull();
    expect(await canView(db, partner.userId, me.userId, at(T0, minutes(6)))).toBe(false);
    expect(await getDeckCandidateIds(db, partner, { now: at(T0, minutes(6)) })).not.toContain(me.userId);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conv } })).status).toBe("LOCKED");
    expect(await db.message.count({ where: { conversationId: conv } })).toBe(1); // history kept for the other side / evidence
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: post.id } })).deletedAt).not.toBeNull();
    expect(await db.report.count({ where: { targetUserId: me.userId } })).toBe(1);
    expect(await db.block.count({ where: { blockedId: me.userId } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "account.deleted", targetId: me.userId } })).toBe(1);
    // The number is no longer attached to anyone; a second deletion is refused.
    expect(await db.user.count({ where: { phoneE164: phone } })).toBe(0);
    await expect(deleteAccount(me, { sessionId: session.sessionId }, { db, storage, now: at(T0, minutes(7)) })).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe("safe presentation DTOs", () => {
  it("membership carries tier, plan and period only; privacy, blocked and profile payloads carry nothing private", async () => {
    await db.subscriptionPlan.create({ data: { code: "MONTHLY", name: "1 month", intervalDays: 30, priceMinor: 14900, isPlaceholderPrice: true } });
    const me = await createUser(db, { now: T0 });
    const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: "MONTHLY" } });
    await db.subscription.create({ data: { userId: me.userId, planId: plan.id, status: "ACTIVE", provider: "stub", providerCustomerRef: "cus_secret", providerSubscriptionRef: "sub_secret", startedAt: T0, currentPeriodStart: T0, currentPeriodEnd: at(T0, hours(24 * 30)) } });
    const m = await getMembership(me, { db, now: T0 });
    expect(m).toMatchObject({ tier: "PLUS", planName: "1 month", cancelAtPeriodEnd: false, paymentsAvailable: false });
    expect(m.plans[0]).toMatchObject({ code: "MONTHLY", name: "1 month", intervalDays: 30, price: null, forSale: false });
    expect(m.currentOrder).toBeNull();
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/cus_secret|sub_secret|provider|override|reason|priceMinor/);
    const privacy = await getPrivacySettings(me, { db, now: T0 });
    expect(JSON.stringify(privacy)).not.toMatch(/hash":|phone|session|userId/);
    const edit = await getEditProfileData(me, { db });
    expect(JSON.stringify(edit)).not.toMatch(/phone|session|tokenHash|providerRef|moderation":"(?!PENDING|APPROVED|REJECTED)/);
  });
});

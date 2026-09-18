/**
 * Photo verification (docs/ARCHITECTURE.md §11): member submission, eligibility, retry window, rate limit, private
 * storage, the state machine, admin decisions, privacy of DTOs, and the boundaries with Google sign-in and Plus.
 */
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { AUDIT_ACTIONS } from "@/server/admin/audit";
import { AdminAccessError, type AdminActor } from "@/server/admin/authz";
import { decideVerification, getVerificationDetail, getVerificationEvidenceUrl, listVerificationQueue } from "@/server/admin/verification";
import { signInWithIdentity } from "@/server/auth/identity";
import { getEntitlements } from "@/server/entitlements";
import { buildVisibleProfiles } from "@/server/profiles/visible-profile";
import { deleteAccount } from "@/server/users/deletion";
import { createSession } from "@/server/auth/session";
import { recordReauthentication } from "@/server/auth/identity";
import { assertVerificationTransition, canTransitionVerification, getVerificationState, submitSelfie, VERIFICATION_RULES } from "@/server/verification";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createIdentity, createUser, grantPlus, hours, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-18T08:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage-verification", "v".repeat(32));

async function selfie(hue = 30): Promise<{ bytes: Uint8Array; size: number }> {
  const bytes = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 200, g: 150 + hue, b: 120 } } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: "exif-marker", ImageDescription: "GPS 4.17N 73.5E" } } }).toBuffer());
  return { bytes, size: bytes.byteLength };
}
async function makeAdmin(role: "ADMIN" | "MODERATOR" = "ADMIN"): Promise<AdminActor> {
  const u = await createUser(db, { now: T0 });
  await db.user.update({ where: { id: u.userId }, data: { role } });
  return { userId: u.userId, role };
}
const status = async (u: TestUser) => (await db.verification.findUniqueOrThrow({ where: { userId: u.userId } })).status;

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("submitting a selfie", () => {
  it("16/26 · an active member submits: private key, metadata dropped, status UNDER_REVIEW via manual review, attempts counted", async () => {
    const u = await createUser(db, { now: T0 });
    const before = await getVerificationState(u, { db, storage, now: T0 });
    expect(before).toMatchObject({ phase: "NONE", canSubmit: true, attempts: 0, selfieUrl: null });
    const state = await submitSelfie(u, await selfie(), { db, storage, now: T0 });
    expect(state).toMatchObject({ phase: "PENDING", canSubmit: false, attempts: 1, submittedAt: T0.toISOString(), rejectionReason: null });
    expect(state.selfieUrl).toMatch(/^\/api\/media\/verification-selfies\/.*\?exp=\d+&sig=/);
    const row = await db.verification.findUniqueOrThrow({ where: { userId: u.userId } });
    expect(row).toMatchObject({ status: "UNDER_REVIEW", provider: "manual_review", attempts: 1, decidedAt: null, reviewedById: null });
    expect(row.selfieStorageKey).toMatch(new RegExp(`^verification-selfies/${u.userId}/[0-9a-f-]{36}\\.webp$`));
    const stored = (await storage.read(row.selfieStorageKey!))!;
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(Buffer.from(stored).includes(Buffer.from("exif-marker"))).toBe(false);
  });

  it("23/24/25 · unsupported, oversized, MIME-spoofed and empty files are refused with accurate messages and nothing is stored", async () => {
    const u = await createUser(db, { now: T0 });
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(600).fill(0x20)]);
    await expect(submitSelfie(u, { bytes: pdf, size: pdf.byteLength }, { db, storage, now: T0 })).rejects.toThrow(/PDF/);
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic"), ...new Array(600).fill(0)]);
    await expect(submitSelfie(u, { bytes: heic, size: heic.byteLength }, { db, storage, now: T0 })).rejects.toThrow(/HEIC/);
    const spoof = new Uint8Array(Buffer.from("<html>not an image</html>".repeat(40)));
    await expect(submitSelfie(u, { bytes: spoof, size: spoof.byteLength }, { db, storage, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(submitSelfie(u, { bytes: new Uint8Array(10), size: VERIFICATION_RULES.maxBytes + 1 }, { db, storage, now: T0 })).rejects.toThrow(/too large/);
    await expect(submitSelfie(u, { bytes: new Uint8Array(0), size: 0 }, { db, storage, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    const tiny = new Uint8Array(await sharp({ create: { width: 100, height: 100, channels: 3, background: "#888" } }).png().toBuffer());
    await expect(submitSelfie(u, { bytes: tiny, size: tiny.byteLength }, { db, storage, now: T0 })).rejects.toThrow(/too small/);
    expect(await status(u)).toBe("NONE");
    expect((await db.verification.findUniqueOrThrow({ where: { userId: u.userId } })).selfieStorageKey).toBeNull();
  });

  it("27 · retry is rate limited and the 24-hour window after a rejection is enforced; a new selfie replaces and deletes the old file", async () => {
    const admin = await makeAdmin();
    const u = await createUser(db, { now: T0 });
    await submitSelfie(u, await selfie(), { db, storage, now: T0 });
    const firstKey = (await db.verification.findUniqueOrThrow({ where: { userId: u.userId } })).selfieStorageKey!;
    await expect(submitSelfie(u, await selfie(), { db, storage, now: at(T0, 1000) })).rejects.toBeInstanceOf(InvalidStateError); // already under review
    await decideVerification(admin, u.userId, { decision: "REJECTED", reason: "Face not visible" }, { db, now: at(T0, hours(1)) });
    const rejected = await getVerificationState(u, { db, storage, now: at(T0, hours(2)) });
    expect(rejected).toMatchObject({ phase: "REJECTED", canSubmit: false, rejectionReason: "Face not visible", retryAvailableAt: at(T0, hours(25)).toISOString() });
    await expect(submitSelfie(u, await selfie(), { db, storage, now: at(T0, hours(2)) })).rejects.toThrow(/24 hours/);
    const again = await submitSelfie(u, await selfie(40), { db, storage, now: at(T0, hours(26)) });
    expect(again).toMatchObject({ phase: "PENDING", attempts: 2, rejectionReason: null });
    expect(await storage.read(firstKey)).toBeNull();
    // Rate limit: the hourly cap counts attempts even when they are refused later.
    const v = await createUser(db, { now: T0 });
    for (let i = 0; i < VERIFICATION_RULES.uploadsPerHour; i += 1) {
      await submitSelfie(v, await selfie(), { db, storage, now: at(T0, i) }).catch(() => undefined);
      await db.verification.update({ where: { userId: v.userId }, data: { status: "NONE" } });
    }
    await expect(submitSelfie(v, await selfie(), { db, storage, now: at(T0, 5000) })).rejects.toThrow(/Too many attempts/);
  });

  it("31 · suspended, banned, deleted and onboarding accounts cannot submit; verification never changes the account state", async () => {
    for (const s of ["SUSPENDED", "BANNED", "DELETED"] as const) {
      const u = await createUser(db, { now: T0 });
      await db.user.update({ where: { id: u.userId }, data: { status: s } });
      await expect(submitSelfie(u, await selfie(), { db, storage, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
      expect((await getVerificationState(u, { db, now: T0 })).canSubmit).toBe(false);
    }
    const onboarding = await createUser(db, { now: T0, status: "ONBOARDING" });
    await expect(submitSelfie(onboarding, await selfie(), { db, storage, now: T0 })).rejects.toThrow(/Finish setting up/);
    // A member suspended after submitting can still be decided; the account stays suspended.
    const admin = await makeAdmin();
    const s = await createUser(db, { now: T0 });
    await submitSelfie(s, await selfie(), { db, storage, now: T0 });
    await db.user.update({ where: { id: s.userId }, data: { status: "SUSPENDED" } });
    await decideVerification(admin, s.userId, { decision: "VERIFIED" }, { db, now: at(T0, hours(1)) });
    expect((await db.user.findUniqueOrThrow({ where: { id: s.userId } })).status).toBe("SUSPENDED");
  });
});

describe("state machine", () => {
  it("28 · only the defined edges are allowed", () => {
    expect(canTransitionVerification("NONE", "SELFIE_SUBMITTED")).toBe(true);
    expect(canTransitionVerification("REJECTED", "SELFIE_SUBMITTED")).toBe(true);
    expect(canTransitionVerification("SELFIE_SUBMITTED", "UNDER_REVIEW")).toBe(true);
    expect(canTransitionVerification("UNDER_REVIEW", "VERIFIED")).toBe(true);
    expect(canTransitionVerification("UNDER_REVIEW", "REJECTED")).toBe(true);
    for (const [from, to] of [["NONE", "VERIFIED"], ["NONE", "UNDER_REVIEW"], ["VERIFIED", "REJECTED"], ["VERIFIED", "SELFIE_SUBMITTED"], ["REJECTED", "VERIFIED"], ["UNDER_REVIEW", "NONE"]] as const) {
      expect(canTransitionVerification(from, to), `${from} → ${to}`).toBe(false);
      expect(() => assertVerificationTransition(from, to)).toThrow(InvalidStateError);
    }
  });
  it("17/18 · a member cannot verify themselves or set a status: the only member entry point is the selfie upload", async () => {
    const u = await createUser(db, { now: T0 });
    const state = await submitSelfie(u, await selfie(), { db, storage, now: T0 });
    // The member DTO has no status setter and carries only the phase; the row is UNDER_REVIEW, not VERIFIED.
    expect(Object.keys(state).sort()).toEqual(["attempts", "canSubmit", "decidedAt", "phase", "rejectionReason", "retryAvailableAt", "selfieUrl", "submittedAt"]);
    expect(await status(u)).toBe("UNDER_REVIEW");
    const profiles = await buildVisibleProfiles(db, u.userId, [u.userId], T0);
    expect(profiles[0]?.verified).toBe(false);
    // Only an admin decision reaches VERIFIED, and a member with no pending submission cannot be decided at all.
    const fresh = await createUser(db, { now: T0 });
    await expect(decideVerification(await makeAdmin(), fresh.userId, { decision: "VERIFIED" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe("admin review", () => {
  it("19/29/30 · admin or moderator decides under permission; both outcomes are audited and notify the member; the badge follows VERIFIED only", async () => {
    const admin = await makeAdmin();
    const mod = await makeAdmin("MODERATOR");
    const a = await createUser(db, { now: T0, name: "Aisha" });
    const b = await createUser(db, { now: T0, name: "Bilal" });
    await submitSelfie(a, await selfie(), { db, storage, now: T0 });
    await submitSelfie(b, await selfie(), { db, storage, now: at(T0, 1000) });
    const fake = { userId: a.userId, role: "USER" as unknown as "ADMIN" };
    await expect(listVerificationQueue(fake, { db })).rejects.toBeInstanceOf(Error);
    await expect(decideVerification(fake, a.userId, { decision: "VERIFIED" }, { db })).rejects.toBeInstanceOf(Error);
    await expect(decideVerification(admin, admin.userId, { decision: "VERIFIED" }, { db })).rejects.toBeInstanceOf(InvalidStateError);
    const queue = await listVerificationQueue(mod, { db });
    expect(queue.items.map((i) => i.userId)).toEqual([a.userId, b.userId]);
    expect(await decideVerification(mod, a.userId, { decision: "VERIFIED" }, { db, now: at(T0, hours(1)) })).toEqual({ userId: a.userId, status: "VERIFIED" });
    await expect(decideVerification(admin, b.userId, { decision: "REJECTED", reason: "" }, { db })).rejects.toBeInstanceOf(ValidationError);
    await decideVerification(admin, b.userId, { decision: "REJECTED", reason: "Sunglasses on" }, { db, now: at(T0, hours(1)) });
    const audits = await db.auditLog.findMany({ where: { action: AUDIT_ACTIONS.verificationDecided }, orderBy: { createdAt: "asc" } });
    expect(audits.map((x) => [x.actorId, x.targetId])).toEqual([[mod.userId, a.userId], [admin.userId, b.userId]]);
    expect(audits[1]!.data).toMatchObject({ reason: "Sunglasses on", before: { status: "UNDER_REVIEW" }, after: { status: "REJECTED" } });
    expect(await db.notification.count({ where: { userId: a.userId, type: "VERIFICATION_UPDATE" } })).toBe(1);
    expect((await db.notification.findFirst({ where: { userId: b.userId, type: "VERIFICATION_UPDATE" } }))!.data).toMatchObject({ status: "REJECTED", reason: "Sunglasses on" });
    expect((await buildVisibleProfiles(db, b.userId, [a.userId], T0))[0]?.verified).toBe(true);
    expect((await buildVisibleProfiles(db, a.userId, [b.userId], T0))[0]?.verified).toBe(false);
    // Decided twice is refused; the queue is empty.
    await expect(decideVerification(admin, a.userId, { decision: "REJECTED", reason: "later" }, { db })).rejects.toBeInstanceOf(InvalidStateError);
    expect((await listVerificationQueue(admin, { db })).total).toBe(0);
    // The detail carries the selfie, profile photos and the history for a reviewer.
    const detail = await getVerificationDetail(admin, b.userId, { db, storage });
    expect(detail).toMatchObject({ status: "REJECTED", attempts: 1, rejectionReason: "Sunglasses on", displayName: "Bilal" });
    expect(detail.selfieUrl).toMatch(/^\/api\/media\/verification-selfies\//);
    expect(detail.profilePhotos).toHaveLength(2);
    expect(detail.history).toEqual([expect.objectContaining({ decision: "REJECTED", reason: "Sunglasses on" })]);
    await expect(getVerificationDetail(admin, "missing", { db, storage })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("privacy and boundaries", () => {
  it("20/21/22/40 · the selfie is private: signed URLs expire, keys never reach a DTO, other members cannot obtain it, and it is never a profile photo", async () => {
    const admin = await makeAdmin();
    const u = await createUser(db, { now: T0 });
    const other = await createUser(db, { now: T0 });
    const state = await submitSelfie(u, await selfie(), { db, storage, now: T0 });
    const url = new URL(`http://x${state.selfieUrl}`);
    const key = decodeURIComponent(url.pathname.replace("/api/media/", ""));
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(exp * 1000 - Date.now()).toBeLessThanOrEqual(VERIFICATION_RULES.selfieUrlTtlSeconds * 1000 + 1000);
    expect(storage.verify(key, exp, sig, Date.now())).toBe(true);
    expect(storage.verify(key, exp, sig, (exp + 1) * 1000)).toBe(false);
    expect(storage.verify(key, exp, "tampered", Date.now())).toBe(false);
    // The owner's DTO carries only the signed URL (never the raw key field); nobody else's DTO references the file at all.
    expect(JSON.stringify(state)).not.toContain("selfieStorageKey");
    expect(JSON.stringify(await getVerificationState(u, { db, now: T0 }))).not.toContain("verification-selfies");
    expect(JSON.stringify(await getVerificationState(other, { db, storage, now: T0, withSelfie: true }))).not.toContain("verification-selfies");
    // Another member has no read model that reaches this selfie: their own state is theirs; visible profiles carry only a boolean.
    expect((await getVerificationState(other, { db, storage, now: T0, withSelfie: true })).selfieUrl).toBeNull();
    const visible = await buildVisibleProfiles(db, other.userId, [u.userId], T0);
    expect(JSON.stringify(visible)).not.toContain("verification-selfies");
    expect(await db.profilePhoto.count({ where: { profile: { userId: u.userId }, storageKey: { startsWith: "verification-selfies" } } })).toBe(0);
    // The reviewer's URL is short-lived too, and a moderator-less role gets nothing.
    expect(await getVerificationEvidenceUrl(admin, u.userId, { db, storage })).toMatch(/exp=\d+&sig=/);
    await expect(getVerificationEvidenceUrl({ userId: other.userId, role: "USER" as unknown as "ADMIN" }, u.userId, { db, storage })).rejects.toBeInstanceOf(Error);
    await expect(listVerificationQueue({ userId: other.userId, role: "USER" as unknown as "MODERATOR" }, { db })).rejects.toBeInstanceOf(Error);
    await expect(listVerificationQueue({ userId: other.userId, role: "MODERATOR" }, { db })).resolves.toBeTruthy();
    expect(() => { throw new AdminAccessError("x"); }).toThrow(AdminAccessError);
  });

  it("32 · account deletion removes the selfie file and resets the verification", async () => {
    const u = await createUser(db, { now: T0 });
    await createIdentity(db, u.userId, { subject: "google-sub-del", email: "del@example.com" });
    await submitSelfie(u, await selfie(), { db, storage, now: T0 });
    const key = (await db.verification.findUniqueOrThrow({ where: { userId: u.userId } })).selfieStorageKey!;
    expect(await storage.read(key)).not.toBeNull();
    const session = await createSession(db, u.userId);
    await recordReauthentication(db, { sessionId: session.sessionId, userId: u.userId, claims: { subject: "google-sub-del", email: "del@example.com", emailVerified: true, name: null } as never }, at(T0, 1000));
    const result = await deleteAccount(u, { sessionId: session.sessionId }, { db, storage, now: at(T0, 2000) });
    expect(result).toEqual({ ok: true });
    expect(await storage.read(key)).toBeNull();
    expect(await db.verification.findUniqueOrThrow({ where: { userId: u.userId } })).toMatchObject({ status: "NONE", selfieStorageKey: null });
    await expect(submitSelfie(u, await selfie(), { db, storage, now: at(T0, 3000) })).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("33/34/35 · Google sign-in never grants verification; verification never grants Plus; Plus never grants verification", async () => {
    const signedIn = await signInWithIdentity(db, { subject: "google-new", email: "new@example.com", emailVerified: true, name: "New" } as never, T0);
    if (signedIn.kind !== "signed-in") throw new Error("expected a sign-in");
    expect((await db.verification.findUniqueOrThrow({ where: { userId: signedIn.userId } })).status).toBe("NONE");
    const admin = await makeAdmin();
    const v = await createUser(db, { now: T0 });
    await submitSelfie(v, await selfie(), { db, storage, now: T0 });
    await decideVerification(admin, v.userId, { decision: "VERIFIED" }, { db, now: at(T0, 1000) });
    expect((await getEntitlements(db, v.userId, at(T0, 2000))).tier).toBe("FREE");
    const p = await createUser(db, { now: T0 });
    await grantPlus(db, p.userId, T0, at(T0, hours(24)));
    expect((await getEntitlements(db, p.userId, at(T0, 1000))).tier).toBe("PLUS");
    expect(await status(p)).toBe("NONE");
    expect((await buildVisibleProfiles(db, v.userId, [p.userId], T0))[0]?.verified).toBe(false);
  });
});

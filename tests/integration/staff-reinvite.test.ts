/**
 * Revoking a staff authorisation and issuing a new one, end to end (docs/ARCHITECTURE.md §22.10).
 *
 * The production incident these cover: `claimedByUserId` carried a PLAIN unique index while `email` carried a
 * partial one excluding REVOKED rows. Revoking therefore freed the address but not the account, so a re-invited
 * administrator could never claim their new invitation — every attempt died on `StaffGrant_claimedByUserId_key`
 * with P2002. The server action had no try/catch, so the throw reached the form's `.catch()` and became nothing
 * at all: no message, no clue. Twenty clicks later the rate limiter said "Too many attempts", which was the first
 * and only thing the portal ever told him.
 *
 * So these tests assert two independent things. The database must let a revoked person be re-invited onto the
 * account they already have, and the portal must never fail silently while it does.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitLock } from "@/lib/submit-lock";
import { adminActorFrom, type AdminActor } from "@/server/admin/authz";
import { verifyPassword } from "@/server/auth/password";
import { createSession, hashSessionToken } from "@/server/auth/session";
import { claimStaffInvite, describeInvite } from "@/server/staff/claim";
import { isLiveStaff, signInStaff } from "@/server/staff/auth";
import { createStaffGrant, revokeStaffGrant } from "@/server/staff/grants";
import { findLiveStaffGrant } from "@/server/staff/live-grant";
import { STAFF_RULES } from "@/server/staff/rules";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { createStaff } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-20T00:00:00Z");
const LATER = new Date("2026-09-21T00:00:00Z");
const FIRST = "first-password-42";
const SECOND = "second-password-42";
const EMAIL = "lushan@example.com";

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

async function admin(): Promise<AdminActor> {
  const staff = await createStaff(db, { role: "ADMIN", now: T0 });
  return { userId: staff.userId, role: "ADMIN" };
}

/** The whole lifecycle in one helper: authorise the address, claim it, and hand back the account it produced. */
async function inviteAndClaim(a: AdminActor, email: string, password: string, now: Date): Promise<string> {
  const grant = await createStaffGrant(a, { email, role: "ADMIN", reason: "Welcome aboard" }, { db, now });
  const claim = await claimStaffInvite({ token: grant.token, password }, { db, now });
  if (!claim.ok) throw new Error(`claim refused: ${claim.code}`);
  return claim.userId;
}

// ───────────────────────── 1. Invite → set password → sign in ─────────────────────────

describe("an invited administrator can set a password and sign in", () => {
  it("claims the invitation, gets a STAFF account with an ACTIVE grant, and signs in with it", async () => {
    const a = await admin();
    const userId = await inviteAndClaim(a, EMAIL, FIRST, T0);

    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { accountType: true, role: true, status: true } });
    expect(user).toMatchObject({ accountType: "STAFF", role: "ADMIN", status: "ACTIVE" });
    expect(await findLiveStaffGrant(db, userId)).toMatchObject({ role: "ADMIN" });

    const signIn = await signInStaff({ email: EMAIL, password: FIRST }, { db, now: T0 });
    expect(signIn).toMatchObject({ ok: true, value: { userId, role: "ADMIN" } });
  });
});

// ───────────────────── 2 & 3. New browser, new device, existing session ─────────────────────

describe("the same administrator signs in from anywhere", () => {
  it("a completely new browser with no cookie signs in on credentials alone", async () => {
    const a = await admin();
    const userId = await inviteAndClaim(a, EMAIL, FIRST, T0);
    // A fresh browser is exactly this: no session row of its own, nothing but the address and the password.
    await db.session.deleteMany({ where: { userId } });

    const signIn = await signInStaff({ email: EMAIL, password: FIRST }, { db, now: LATER });
    expect(signIn.ok).toBe(true);
    // Nothing about signing in creates a second account or a second identity.
    expect(await db.user.count({ where: { accountType: "STAFF" } })).toBe(2); // the inviting admin, and him
    expect(await db.authIdentity.count({ where: { providerSubject: EMAIL } })).toBe(1);
  });

  it("a desktop sign-in adds a session beside the phone's rather than replacing it", async () => {
    const a = await admin();
    const userId = await inviteAndClaim(a, EMAIL, FIRST, T0);
    const phone = await createSession(db, userId, { userAgent: "phone" }, T0);

    const desktop = await signInStaff({ email: EMAIL, password: FIRST }, { db, now: LATER });
    expect(desktop.ok).toBe(true);
    await createSession(db, userId, { userAgent: "desktop" }, LATER);

    // The phone's session is untouched: signing in elsewhere is not a reason to sign somebody out here.
    const kept = await db.session.findFirst({ where: { tokenHash: hashSessionToken(phone.token) } });
    expect(kept).not.toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(2);
  });
});

// ───────────────────────────── 4. Revoked staff cannot sign in ─────────────────────────────

describe("revoked staff", () => {
  it("cannot sign in, and is not an admin actor even with a session that says STAFF", async () => {
    const a = await admin();
    const userId = await inviteAndClaim(a, EMAIL, FIRST, T0);
    const grant = await db.staffGrant.findFirstOrThrow({ where: { claimedByUserId: userId }, select: { id: true } });
    await revokeStaffGrant(a, grant.id, { reason: "Left the team" }, { db, now: LATER });

    expect(await signInStaff({ email: EMAIL, password: FIRST }, { db, now: LATER })).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(await isLiveStaff(db, userId)).toBe(false);
    expect(await findLiveStaffGrant(db, userId)).toBeNull();

    // Server-side authorisation, not a hidden menu: the account row still says STAFF, and it still gets nothing.
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, accountType: true, role: true, status: true } });
    expect(user.accountType).toBe("STAFF");
    expect(adminActorFrom(user)).toBeNull(); // role was demoted to USER by the revocation
  });
});

// ─────────────────── 5. Re-inviting links to the identity that already exists ───────────────────

describe("re-inviting somebody who was revoked", () => {
  it("claims onto the account they already have, with no second account and no second identity", async () => {
    const a = await admin();
    const firstUserId = await inviteAndClaim(a, EMAIL, FIRST, T0);
    const firstGrant = await db.staffGrant.findFirstOrThrow({ where: { claimedByUserId: firstUserId }, select: { id: true } });
    await revokeStaffGrant(a, firstGrant.id, { reason: "Stepping away" }, { db, now: LATER });

    // The exact sequence that failed in production: revoke, re-invite, claim.
    const reinvite = await createStaffGrant(a, { email: EMAIL, role: "ADMIN", reason: "Back again" }, { db, now: LATER });
    const claim = await claimStaffInvite({ token: reinvite.token, password: SECOND }, { db, now: LATER });

    expect(claim).toMatchObject({ ok: true, userId: firstUserId, created: false });
    expect(await db.user.count({ where: { accountType: "STAFF" } })).toBe(2);
    expect(await db.authIdentity.count({ where: { providerSubject: EMAIL } })).toBe(1);

    // The revoked grant keeps its history AND its link to the account; the new one is the live authority.
    const grants = await db.staffGrant.findMany({ where: { email: EMAIL }, orderBy: { createdAt: "asc" }, select: { id: true, status: true, claimedByUserId: true } });
    expect(grants).toHaveLength(2);
    expect(grants[0]).toMatchObject({ id: firstGrant.id, status: "REVOKED", claimedByUserId: firstUserId });
    expect(grants[1]).toMatchObject({ id: reinvite.grantId, status: "ACTIVE", claimedByUserId: firstUserId });
    expect(await findLiveStaffGrant(db, firstUserId)).toMatchObject({ id: reinvite.grantId, role: "ADMIN" });

    // The new password works and the old one does not — the claim really did replace the verifier.
    expect(await signInStaff({ email: EMAIL, password: SECOND }, { db, now: LATER })).toMatchObject({ ok: true });
    expect(await signInStaff({ email: EMAIL, password: FIRST }, { db, now: LATER })).toMatchObject({ ok: false });
  });

  it("still refuses to bind a second OPEN grant to one account, with a sentence rather than a crash", async () => {
    const a = await admin();
    const userId = await inviteAndClaim(a, EMAIL, FIRST, T0);

    // A second live authorisation for the same person, reached through a different address.
    const other = await createStaffGrant(a, { email: "lushan.work@example.com", role: "MODERATOR", reason: "Second hat" }, { db, now: LATER });
    await db.authIdentity.update({ where: { provider_providerSubject: { provider: "EMAIL", providerSubject: EMAIL } }, data: { providerSubject: "lushan.work@example.com" } });

    const claim = await claimStaffInvite({ token: other.token, password: SECOND }, { db, now: LATER });
    expect(claim).toMatchObject({ ok: false, code: "ALREADY_STAFF" });
    // Refused, not crashed, and nothing moved.
    expect(await findLiveStaffGrant(db, userId)).not.toBeNull();
    expect(await db.staffGrant.count({ where: { claimedByUserId: userId, status: "ACTIVE" } })).toBe(1);
  });

  it("the database itself refuses two live grants on one account, and allows any number of revoked ones", async () => {
    const a = await admin();
    const userId = await inviteAndClaim(a, EMAIL, FIRST, T0);
    const live = await db.staffGrant.findFirstOrThrow({ where: { claimedByUserId: userId, status: "ACTIVE" }, select: { id: true } });

    await expect(
      db.staffGrant.create({ data: { email: "second@example.com", role: "ADMIN", reason: "should not be allowed", status: "ACTIVE", claimedByUserId: userId, claimedAt: LATER, createdAt: LATER } }),
    ).rejects.toMatchObject({ code: "P2002" });

    // Revoked rows are history and never collide, however many there are.
    await db.staffGrant.update({ where: { id: live.id }, data: { status: "REVOKED", revokedAt: LATER } });
    for (const email of ["a@example.com", "b@example.com"]) {
      await db.staffGrant.create({ data: { email, role: "ADMIN", reason: "old stint", status: "REVOKED", claimedByUserId: userId, claimedAt: T0, revokedAt: LATER, createdAt: T0 } });
    }
    expect(await db.staffGrant.count({ where: { claimedByUserId: userId } })).toBe(3);
    expect(await findLiveStaffGrant(db, userId)).toBeNull();
  });
});

// ───────────────────── 6, 7, 8. One click, one request — and 429 without a loop ─────────────────────

describe("the portal forms make exactly one request per click", () => {
  it("a single click produces exactly one call", async () => {
    const lock = createSubmitLock();
    const work = vi.fn(async () => "sent");
    const attempt = await lock.run(work);
    expect(attempt).toEqual({ ran: true, value: "sent" });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("a double click cannot produce two: the second is refused while the first is in flight", async () => {
    const lock = createSubmitLock();
    let release: () => void = () => {};
    const inFlight = new Promise<void>((r) => { release = r; });
    const work = vi.fn(() => inFlight.then(() => "sent"));

    // Both clicks dispatched before any state could possibly have updated — the case React state cannot catch.
    const [first, second] = [lock.run(work), lock.run(work)];
    release();
    expect(await first).toEqual({ ran: true, value: "sent" });
    expect(await second).toEqual({ ran: false, reason: "in-flight" });
    expect(work).toHaveBeenCalledTimes(1);

    // And the lock is released afterwards, so one failure never wedges the form shut.
    expect(lock.isLocked()).toBe(false);
  });

  it("a thrown request still releases the lock", async () => {
    const lock = createSubmitLock();
    await expect(lock.run(async () => { throw new Error("network"); })).rejects.toThrow("network");
    expect(lock.isLocked()).toBe(false);
    expect((await lock.run(async () => "ok")).ran).toBe(true);
  });

  it("a rate-limited form waits out the cooldown and generates no traffic while it does", async () => {
    const lock = createSubmitLock();
    const work = vi.fn(async () => "sent");
    const now = Date.UTC(2026, 8, 22, 12, 0, 0);

    lock.cool(120, now);
    expect(lock.isLocked(now)).toBe(true);
    expect(lock.remaining(now)).toBe(120);

    // Every click during the cooldown is refused locally. The work is never called, so nothing reaches the server.
    for (let i = 0; i < 10; i += 1) expect(await lock.run(work, now + i * 1000)).toEqual({ ran: false, reason: "cooling-down" });
    expect(work).not.toHaveBeenCalled();

    // A longer window replaces a shorter one; a shorter one never shortens a longer.
    lock.cool(30, now);
    expect(lock.remaining(now)).toBe(120);

    expect((await lock.run(work, now + 120_001)).ran).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("the server tells the form how long to wait instead of only saying 'too many attempts'", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: EMAIL, role: "ADMIN", reason: "Welcome aboard" }, { db, now: T0 });

    // Exhaust the per-client claim budget with deliberately wrong tokens.
    for (let i = 0; i < STAFF_RULES.claimAttemptsPerClientHour; i += 1) {
      await claimStaffInvite({ token: "not-a-real-token-at-all", password: FIRST }, { db, now: T0, clientKey: "203.0.113.0" });
    }
    const limited = await claimStaffInvite({ token: grant.token, password: FIRST }, { db, now: T0, clientKey: "203.0.113.0" });
    expect(limited).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    if (limited.ok) throw new Error("unreachable");
    expect(limited.retryAt).toBeInstanceOf(Date);
    expect(limited.retryAt!.getTime()).toBeGreaterThan(T0.getTime());

    // Being rate-limited must not spend the invitation: it is still claimable from somewhere else.
    expect(await claimStaffInvite({ token: grant.token, password: FIRST }, { db, now: T0, clientKey: "198.51.100.0" })).toMatchObject({ ok: true });
  });
});

// ─────────────────── 9. Refreshing the set-password page creates nothing ───────────────────

describe("the set-password page", () => {
  it("refreshing it neither spends the invitation nor creates an account", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: EMAIL, role: "ADMIN", reason: "Welcome aboard" }, { db, now: T0 });
    const before = await db.user.count();

    // Rendering the page is a peek, not a claim, however many times it happens.
    for (let i = 0; i < 5; i += 1) {
      expect(await describeInvite(db, grant.token, T0)).toMatchObject({ email: EMAIL, role: "ADMIN", setup: true });
    }
    expect(await db.user.count()).toBe(before);
    expect(await db.staffInvite.count({ where: { grantId: grant.grantId, consumedAt: null } })).toBe(1);

    // And once it IS claimed, replaying the same token creates nothing either — the link is single-use.
    const claim = await claimStaffInvite({ token: grant.token, password: FIRST }, { db, now: T0 });
    expect(claim.ok).toBe(true);
    const after = await db.user.count();
    expect(await claimStaffInvite({ token: grant.token, password: SECOND }, { db, now: T0 })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
    expect(await db.user.count()).toBe(after);

    // The replay did not quietly change the password either.
    const identity = await db.authIdentity.findUniqueOrThrow({ where: { provider_providerSubject: { provider: "EMAIL", providerSubject: EMAIL } }, select: { passwordHash: true } });
    expect((await verifyPassword(FIRST, identity.passwordHash)).ok).toBe(true);
    expect((await verifyPassword(SECOND, identity.passwordHash)).ok).toBe(false);
  });

  it("two clicks on one invitation link claim it exactly once", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: EMAIL, role: "ADMIN", reason: "Welcome aboard" }, { db, now: T0 });

    const results = await Promise.allSettled([
      claimStaffInvite({ token: grant.token, password: FIRST }, { db, now: T0 }),
      claimStaffInvite({ token: grant.token, password: SECOND }, { db, now: T0 }),
    ]);
    const claimed = results.filter((r) => r.status === "fulfilled" && r.value.ok);
    expect(claimed).toHaveLength(1);
    expect(await db.authIdentity.count({ where: { providerSubject: EMAIL } })).toBe(1);
    expect(await db.staffGrant.count({ where: { email: EMAIL, status: "ACTIVE" } })).toBe(1);
  });
});

// ─────────────── 10. Authorisation is re-checked server-side after authentication ───────────────

describe("staff authorisation is a server-side check on every request", () => {
  it("a live session stops being an admin actor the moment the grant is revoked", async () => {
    const a = await admin();
    const userId = await inviteAndClaim(a, EMAIL, FIRST, T0);
    const grantId = (await db.staffGrant.findFirstOrThrow({ where: { claimedByUserId: userId, status: "ACTIVE" }, select: { id: true } })).id;

    // Authenticated, with a session, and authorised.
    await createSession(db, userId, { userAgent: "desktop" }, T0);
    expect(await isLiveStaff(db, userId)).toBe(true);

    await revokeStaffGrant(a, grantId, { reason: "Access ended" }, { db, now: LATER });

    // The authority is read from the grant on every request, so it is gone immediately — not at the next sign-in.
    expect(await isLiveStaff(db, userId)).toBe(false);
    expect(await findLiveStaffGrant(db, userId)).toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(0);
  });

  it("a pending grant authorises nothing until it is claimed", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: EMAIL, role: "ADMIN", reason: "Not yet" }, { db, now: T0 });
    const row = await db.staffGrant.findUniqueOrThrow({ where: { id: grant.grantId }, select: { status: true, claimedByUserId: true } });
    expect(row).toMatchObject({ status: "PENDING", claimedByUserId: null });
    expect(await signInStaff({ email: EMAIL, password: FIRST }, { db, now: T0 })).toMatchObject({ ok: false });
  });
});

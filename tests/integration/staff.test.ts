/**
 * The staff account system end to end (docs/ARCHITECTURE.md §22.1–§22.7): authorising an address, the invitation
 * lifecycle, portal authentication, passwords, the member/staff boundary, MEMBER → STAFF conversion, last-admin
 * protection and the audit trail.
 *
 * These tests run against a real Postgres, so the concurrency and uniqueness claims are actually exercised rather
 * than mocked.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ConsoleEmailProvider } from "@/lib/email/console";
import { InvalidStateError, ValidationError } from "@/lib/errors";
import { AUDIT_ACTIONS } from "@/server/admin/audit";
import { AdminAccessError, adminActorFrom, type AdminActor } from "@/server/admin/authz";
import { authKindForUser } from "@/server/auth/session";
import { resolveAccess } from "@/server/auth/route-access";
import { verifyPassword } from "@/server/auth/password";
import { claimStaffInvite, createStaffAccount, describeInvite } from "@/server/staff/claim";
import { isLiveStaff, requestStaffPasswordReset, resetStaffPassword, signInStaff } from "@/server/staff/auth";
import { inventoryMemberData, planConversion } from "@/server/staff/conversion";
import { cancelStaffInvite, changeStaffRole, countLiveAdmins, createStaffGrant, listStaffGrants, resendStaffInvite, revokeStaffGrant } from "@/server/staff/grants";
import { promoteAccountToStaff, previewPromotion } from "@/server/staff/promote";
import { normalizeStaffEmail } from "@/server/staff/rules";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { createIdentity, createStaff, createUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-19T00:00:00Z");
const PASSWORD = "sunset-lagoon-42";

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

async function admin(role: "ADMIN" | "MODERATOR" = "ADMIN"): Promise<AdminActor> {
  const staff = await createStaff(db, { role, now: T0 });
  return { userId: staff.userId, role };
}

/** Pulls the raw token out of the email body, which is the only place it exists. */
function tokenFrom(mailbox: ConsoleEmailProvider): string {
  const text = mailbox.sent.at(-1)?.text ?? "";
  return /[?&]token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";
}

// ───────────────────────────── Creating staff ─────────────────────────────

describe("staff creation", () => {
  it("an ADMIN authorises an address, and the invitation token never leaves the email", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: "  New.Person@Example.COM ", role: "MODERATOR", reason: "Community moderation" }, { db, now: T0 });
    expect(grant.email).toBe("new.person@example.com"); // trimmed and lowercased
    expect(grant.token).toHaveLength(43);

    const rows = await listStaffGrants(db);
    const row = rows.find((r) => r.email === "new.person@example.com");
    expect(row).toMatchObject({ role: "MODERATOR", status: "PENDING", claimedByUserId: null });
    // Nothing the admin screen reads carries a secret.
    expect(JSON.stringify(rows)).not.toContain(grant.token);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.staffInvited } });
    expect(audit.actorId).toBe(a.userId);
    expect(JSON.stringify(audit.data)).not.toContain(grant.token);
  });

  it("a MODERATOR cannot create staff", async () => {
    const mod = await admin("MODERATOR");
    await expect(createStaffGrant(mod, { email: "x@example.com", role: "MODERATOR", reason: "nope" }, { db, now: T0 })).rejects.toBeInstanceOf(AdminAccessError);
    expect(await db.staffGrant.count({ where: { email: "x@example.com" } })).toBe(0);
  });

  it("refuses an invalid address, a missing reason and a non-staff role", async () => {
    const a = await admin();
    await expect(createStaffGrant(a, { email: "not-an-email", role: "ADMIN", reason: "valid reason" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createStaffGrant(a, { email: "ok@example.com", role: "ADMIN", reason: "no" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createStaffGrant(a, { email: "ok@example.com", role: "USER" as never, reason: "valid reason" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a duplicate open grant, whatever the capitalisation, and under concurrency", async () => {
    const a = await admin();
    await createStaffGrant(a, { email: "dupe@example.com", role: "MODERATOR", reason: "first one" }, { db, now: T0 });
    await expect(createStaffGrant(a, { email: "DUPE@example.com", role: "ADMIN", reason: "second one" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);

    // Two admins racing on a fresh address: the partial unique index means exactly one wins.
    const results = await Promise.allSettled([
      createStaffGrant(a, { email: "race@example.com", role: "MODERATOR", reason: "racer one" }, { db, now: T0 }),
      createStaffGrant(a, { email: "race@example.com", role: "MODERATOR", reason: "racer two" }, { db, now: T0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.staffGrant.count({ where: { email: "race@example.com", status: { not: "REVOKED" } } })).toBe(1);
  });

  it("a revoked grant frees the address again", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: "again@example.com", role: "MODERATOR", reason: "first stint" }, { db, now: T0 });
    await cancelStaffInvite(a, grant.grantId, { db, now: T0 });
    const second = await createStaffGrant(a, { email: "again@example.com", role: "ADMIN", reason: "second stint" }, { db, now: T0 });
    expect(second.grantId).not.toBe(grant.grantId);
    expect(await db.staffGrant.count({ where: { email: "again@example.com" } })).toBe(2);
  });
});

// ───────────────────────────── Invitations ─────────────────────────────

describe("staff invitations", () => {
  it("a pending invitation creates a STAFF account with no dating profile at all", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: "fresh@example.com", role: "MODERATOR", reason: "New moderator" }, { db, now: T0 });

    // `now` explicitly, like every other call in this test. The default is the real clock, and STAFF_RULES gives an
    // invite three days: read against wall time this assertion passed until 2026-09-22 and then began failing on
    // its own, describing nothing but the date it was run on.
    expect(await describeInvite(db, grant.token, T0)).toEqual({ email: "fresh@example.com", role: "MODERATOR", setup: true });

    const claimed = await claimStaffInvite({ token: grant.token, password: PASSWORD }, { db, now: T0 });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.created).toBe(true);

    const user = await db.user.findUniqueOrThrow({ where: { id: claimed.userId } });
    expect(user.accountType).toBe("STAFF");
    expect(user.role).toBe("MODERATOR");
    expect(user.status).toBe("ACTIVE");
    expect(user.onboardingCompletedAt).toBeNull();

    // The whole point: none of the dating tables know about this account.
    const inv = await inventoryMemberData(db, claimed.userId);
    expect(inv.profile).toBe(0);
    expect(inv.profilePhotos).toBe(0);
    expect(inv.privacySettings).toBe(0);
    expect(inv.discoveryPreferences).toBe(0);
    expect(inv.verification).toBe(0);

    expect(await isLiveStaff(db, claimed.userId)).toBe(true);
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.staffActivated, targetId: claimed.userId } })).toBe(1);
  });

  it("the password is stored as a verifier and the plaintext is never persisted anywhere", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: "hash@example.com", role: "ADMIN", reason: "Password check" }, { db, now: T0 });
    const claimed = await claimStaffInvite({ token: grant.token, password: PASSWORD }, { db, now: T0 });
    expect(claimed.ok).toBe(true);

    const identity = await db.authIdentity.findFirstOrThrow({ where: { provider: "EMAIL", providerSubject: "hash@example.com" } });
    expect(identity.passwordHash).toMatch(/^scrypt\$/);
    expect(identity.passwordHash).not.toContain(PASSWORD);
    expect((await verifyPassword(PASSWORD, identity.passwordHash)).ok).toBe(true);
    expect(identity.emailVerified).toBe(true);

    // Not in the audit trail either.
    const rows = await db.auditLog.findMany();
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
    expect(JSON.stringify(rows)).not.toContain(grant.token);
  });

  it("an expired, spent, cancelled or unknown invitation is refused with one indistinguishable message", async () => {
    const a = await admin();
    const later = new Date(T0.getTime() + 4 * 24 * 3_600_000);

    const expired = await createStaffGrant(a, { email: "expired@example.com", role: "ADMIN", reason: "Expiry check" }, { db, now: T0 });
    const expiredResult = await claimStaffInvite({ token: expired.token, password: PASSWORD }, { db, now: later });
    expect(expiredResult).toMatchObject({ ok: false, code: "INVALID_TOKEN" });

    const spent = await createStaffGrant(a, { email: "spent@example.com", role: "ADMIN", reason: "Reuse check" }, { db, now: T0 });
    expect((await claimStaffInvite({ token: spent.token, password: PASSWORD }, { db, now: T0 })).ok).toBe(true);
    const reuse = await claimStaffInvite({ token: spent.token, password: "another-password-9" }, { db, now: T0 });
    expect(reuse).toMatchObject({ ok: false, code: "INVALID_TOKEN" });

    const cancelled = await createStaffGrant(a, { email: "cancelled@example.com", role: "ADMIN", reason: "Cancel check" }, { db, now: T0 });
    await cancelStaffInvite(a, cancelled.grantId, { db, now: T0 });
    expect(await claimStaffInvite({ token: cancelled.token, password: PASSWORD }, { db, now: T0 })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });

    expect(await claimStaffInvite({ token: "made-up-token-value-that-is-long", password: PASSWORD }, { db, now: T0 })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
  });

  it("resending invalidates the previous link", async () => {
    const a = await admin();
    const first = await createStaffGrant(a, { email: "resend@example.com", role: "MODERATOR", reason: "Resend check" }, { db, now: T0 });
    const later = new Date(T0.getTime() + 120_000);
    const second = await resendStaffInvite(a, first.grantId, { db, now: later });
    expect(second.token).not.toBe(first.token);
    expect(await claimStaffInvite({ token: first.token, password: PASSWORD }, { db, now: later })).toMatchObject({ ok: false });
    expect((await claimStaffInvite({ token: second.token, password: PASSWORD }, { db, now: later })).ok).toBe(true);
  });

  it("a weak password is refused and does not spend the invitation", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: "weak@example.com", role: "ADMIN", reason: "Weak password" }, { db, now: T0 });
    expect(await claimStaffInvite({ token: grant.token, password: "short" }, { db, now: T0 })).toMatchObject({ ok: false, code: "WEAK_PASSWORD" });
    // Still usable afterwards: a refusal must not cost the invitation.
    expect((await claimStaffInvite({ token: grant.token, password: PASSWORD }, { db, now: T0 })).ok).toBe(true);
  });

  it("an address that already belongs to a dating member cannot be claimed", async () => {
    // §11: staff access is never conferred by matching email text, and converting a member is an administrator's
    // explicit decision, not a side effect of somebody clicking a link.
    const member = await createUser(db, { now: T0 });
    await db.authIdentity.create({
      data: { userId: member.userId, provider: "EMAIL", providerSubject: "member@example.com", email: "member@example.com", emailVerified: true, passwordHash: "scrypt$65536$8$1$c2FsdA$aGFzaA", createdAt: T0 },
    });
    const a = await admin();
    const grant = await createStaffGrant(a, { email: "member@example.com", role: "ADMIN", reason: "Should be refused" }, { db, now: T0 });

    const result = await claimStaffInvite({ token: grant.token, password: PASSWORD }, { db, now: T0 });
    expect(result).toMatchObject({ ok: false, code: "MEMBER_ACCOUNT" });
    expect((await db.user.findUniqueOrThrow({ where: { id: member.userId } })).accountType).toBe("MEMBER");
    expect((await db.staffGrant.findUniqueOrThrow({ where: { id: grant.grantId } })).status).toBe("PENDING");
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.staffInviteRejected } })).toBe(1);
  });

  it("a Google identity with the same address is never adopted", async () => {
    // A Google account whose email matches an authorised address is a different person as far as the system is
    // concerned: identities are never linked by email text.
    const google = await createUser(db, { now: T0 });
    await createIdentity(db, google.userId, { email: "google-person@example.com" });
    const a = await admin();
    const grant = await createStaffGrant(a, { email: "google-person@example.com", role: "MODERATOR", reason: "Separate account" }, { db, now: T0 });

    const claimed = await claimStaffInvite({ token: grant.token, password: PASSWORD }, { db, now: T0 });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    // A brand-new staff account, not the Google member's.
    expect(claimed.userId).not.toBe(google.userId);
    expect(claimed.created).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: google.userId } })).accountType).toBe("MEMBER");
  });
});

// ───────────────────────────── Portal authentication ─────────────────────────────

describe("admin portal authentication", () => {
  it("a live staff account signs in; a member with a perfect password gets the same refusal", async () => {
    const staff = await createStaff(db, { email: "portal@example.com", password: PASSWORD, now: T0 });
    expect(await signInStaff({ email: "portal@example.com", password: PASSWORD }, { db, now: T0 })).toMatchObject({ ok: true, value: { userId: staff.userId, role: "ADMIN" } });
    // Capitalisation and stray spaces are normalised the same way everywhere.
    expect((await signInStaff({ email: " Portal@Example.com ", password: PASSWORD }, { db, now: T0 })).ok).toBe(true);

    const { hashPassword } = await import("@/server/auth/password");
    const member = await createUser(db, { now: T0 });
    await db.authIdentity.create({
      data: { userId: member.userId, provider: "EMAIL", providerSubject: "justamember@example.com", email: "justamember@example.com", emailVerified: true, passwordHash: await hashPassword(PASSWORD), createdAt: T0 },
    });
    const refused = await signInStaff({ email: "justamember@example.com", password: PASSWORD }, { db, now: T0 });
    expect(refused).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    if (!refused.ok) {
      // Identical wording to an unknown address: the portal never says who is staff.
      const unknown = await signInStaff({ email: "nobody@example.com", password: PASSWORD }, { db, now: T0 });
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) expect(unknown.message).toBe(refused.message);
    }
  });

  it("a revoked account cannot sign in, and a pending one cannot either", async () => {
    const a = await admin();
    const victim = await createStaff(db, { email: "revoked@example.com", password: PASSWORD, role: "MODERATOR", now: T0 });
    expect((await signInStaff({ email: "revoked@example.com", password: PASSWORD }, { db, now: T0 })).ok).toBe(true);

    await revokeStaffGrant(a, victim.grantId, { reason: "Left the team" }, { db, now: T0 });
    expect((await signInStaff({ email: "revoked@example.com", password: PASSWORD }, { db, now: T0 })).ok).toBe(false);
    expect(await isLiveStaff(db, victim.userId)).toBe(false);

    const pending = await createStaff(db, { email: "pending@example.com", password: PASSWORD, status: "PENDING", now: T0 });
    expect((await signInStaff({ email: "pending@example.com", password: PASSWORD }, { db, now: T0 })).ok).toBe(false);
    expect(pending.userId).toBeTruthy();
  });

  it("rate-limits sign-in attempts per address", async () => {
    await createStaff(db, { email: "brute@example.com", password: PASSWORD, now: T0 });
    for (let i = 0; i < 5; i += 1) {
      expect((await signInStaff({ email: "brute@example.com", password: "wrong-password" }, { db, now: T0 })).ok).toBe(false);
    }
    const blocked = await signInStaff({ email: "brute@example.com", password: PASSWORD }, { db, now: T0 });
    expect(blocked).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("revoking ends the revoked account's sessions immediately", async () => {
    const a = await admin();
    const victim = await createStaff(db, { role: "MODERATOR", now: T0 });
    const { createSession, resolveSession } = await import("@/server/auth/session");
    const session = await createSession(db, victim.userId, {}, T0);
    expect(await resolveSession(db, session.token, T0)).not.toBeNull();

    await revokeStaffGrant(a, victim.grantId, { reason: "Access removed" }, { db, now: T0 });
    expect(await resolveSession(db, session.token, T0)).toBeNull();
  });
});

describe("staff passwords", () => {
  it("reset is single-use, expiring, and ends every session", async () => {
    const staff = await createStaff(db, { email: "reset@example.com", password: PASSWORD, now: T0 });
    const mailbox = new ConsoleEmailProvider();
    const { createSession, resolveSession } = await import("@/server/auth/session");
    const session = await createSession(db, staff.userId, {}, T0);

    expect(await requestStaffPasswordReset("reset@example.com", { db, email: mailbox, now: T0 })).toEqual({ ok: true });
    const token = tokenFrom(mailbox);
    expect(token).toBeTruthy();
    expect(mailbox.sent.at(-1)?.text).toContain("/admin/reset-password?token=");

    const done = await resetStaffPassword({ token, password: "brand-new-password-7" }, { db, now: T0 });
    expect(done.ok).toBe(true);
    expect(await resolveSession(db, session.token, T0)).toBeNull();
    expect((await signInStaff({ email: "reset@example.com", password: "brand-new-password-7" }, { db, now: T0 })).ok).toBe(true);

    // Single use.
    expect(await resetStaffPassword({ token, password: "yet-another-password-3" }, { db, now: T0 })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
    // Expiry: an hour later a fresh token is dead.
    const mailbox2 = new ConsoleEmailProvider();
    await requestStaffPasswordReset("reset@example.com", { db, email: mailbox2, now: T0 });
    const stale = tokenFrom(mailbox2);
    expect(await resetStaffPassword({ token: stale, password: "later-password-11" }, { db, now: new Date(T0.getTime() + 2 * 3_600_000) })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
  });

  it("forgot-password answers identically for staff, members and unknown addresses", async () => {
    await createStaff(db, { email: "real-staff@example.com", now: T0 });
    const member = await createUser(db, { now: T0 });
    await db.authIdentity.create({
      data: { userId: member.userId, provider: "EMAIL", providerSubject: "real-member@example.com", email: "real-member@example.com", emailVerified: true, passwordHash: "scrypt$65536$8$1$c2FsdA$aGFzaA", createdAt: T0 },
    });
    const mailbox = new ConsoleEmailProvider();
    expect(await requestStaffPasswordReset("real-staff@example.com", { db, email: mailbox, now: T0 })).toEqual({ ok: true });
    expect(await requestStaffPasswordReset("real-member@example.com", { db, email: mailbox, now: T0 })).toEqual({ ok: true });
    expect(await requestStaffPasswordReset("nobody-at-all@example.com", { db, email: mailbox, now: T0 })).toEqual({ ok: true });
    // Only the staff address actually received anything.
    expect(mailbox.sent).toHaveLength(1);
    expect(mailbox.sent[0]?.to).toBe("real-staff@example.com");
  });

  it("a member's reset token can never confer staff access", async () => {
    // §27: a reset changes a password and nothing else. The member flow refuses a staff identity and vice versa.
    const staff = await createStaff(db, { email: "cross@example.com", password: PASSWORD, now: T0 });
    const mailbox = new ConsoleEmailProvider();
    await requestStaffPasswordReset("cross@example.com", { db, email: mailbox, now: T0 });
    const token = tokenFrom(mailbox);

    const { resetPassword } = await import("@/server/auth/email-identity");
    // The member-side reset refuses the staff token outright.
    expect(await resetPassword({ token, password: "member-side-password-5" }, { db, now: T0 })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
    const after = await db.user.findUniqueOrThrow({ where: { id: staff.userId } });
    expect(after.accountType).toBe("STAFF");
    expect(after.role).toBe("ADMIN");
  });
});

// ───────────────────────────── The member/staff boundary ─────────────────────────────

describe("member and staff domains are mutually exclusive", () => {
  it("a staff session is never classified as a member state", async () => {
    expect(authKindForUser({ accountType: "STAFF", status: "ACTIVE", onboardingCompletedAt: null })).toBe("staff");
    // Not even when the row would otherwise read as a completed member.
    expect(authKindForUser({ accountType: "STAFF", status: "ACTIVE", onboardingCompletedAt: T0 })).toBe("staff");
    // Not "unverified" either, which would park an operator on the member's confirm-your-email screen.
    expect(authKindForUser({ accountType: "STAFF", status: "ACTIVE", onboardingCompletedAt: null, emailVerificationPending: true })).toBe("staff");
    // A suspended staff account is still blocked first.
    expect(authKindForUser({ accountType: "STAFF", status: "SUSPENDED", onboardingCompletedAt: null })).toBe("blocked");
    expect(authKindForUser({ accountType: "MEMBER", status: "ACTIVE", onboardingCompletedAt: T0 })).toBe("active");
  });

  it("every member route sends a staff account to the portal, and the portal is reachable signed out", () => {
    for (const path of ["/discover", "/likes", "/chats", "/community", "/profile", "/settings", "/onboarding", "/"]) {
      expect(resolveAccess("staff", path), path).toEqual({ allow: false, redirectTo: "/admin" });
    }
    for (const path of ["/admin", "/admin/staff", "/admin/login", "/admin/set-password"]) {
      expect(resolveAccess("staff", path), path).toEqual({ allow: true });
      // Anonymous visitors must reach the portal's sign-in rather than being bounced to the dating welcome page.
      expect(resolveAccess("anonymous", path), path).toEqual({ allow: true });
    }
    // An unverified email account still reaches exactly one screen, portal included.
    expect(resolveAccess("unverified", "/admin")).toEqual({ allow: false, redirectTo: "/auth/verify-email" });
  });

  it("a member account can never satisfy the staff guard, whatever its role column says", async () => {
    const member = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: member.userId }, data: { role: "ADMIN" } });
    const row = await db.user.findUniqueOrThrow({ where: { id: member.userId } });
    expect(adminActorFrom(row)).toBeNull();
    expect(await isLiveStaff(db, member.userId)).toBe(false);
  });

  it("a staff account is invisible to every member-facing query", async () => {
    const viewer = await createUser(db, { gender: "MAN", interestedIn: "WOMEN", now: T0 });
    const realCandidate = await createUser(db, { gender: "WOMAN", interestedIn: "MEN", now: T0 });
    const staff = await createStaff(db, { now: T0 });

    const { getDeckCandidateIds, canView } = await import("@/server/discovery/query");
    const deck = await getDeckCandidateIds(db, { userId: viewer.userId }, { now: T0 });
    expect(deck).toContain(realCandidate.userId);
    expect(deck).not.toContain(staff.userId);
    expect(await canView(db, viewer.userId, staff.userId, T0)).toBe(false);
  });

  it("a staff account with a stale profile is still excluded", async () => {
    // Defence in depth (§17): if a Profile ever existed on a staff account — a bad migration, a restored backup,
    // a future bug — the predicate must still refuse it rather than relying on the join being empty.
    const viewer = await createUser(db, { gender: "MAN", interestedIn: "WOMEN", now: T0 });
    const malformed = await createUser(db, { gender: "WOMAN", interestedIn: "MEN", now: T0 });
    // Keep every member row, then flip only the account type: exactly the malformed state we are defending against.
    await db.user.update({ where: { id: malformed.userId }, data: { accountType: "STAFF", role: "ADMIN" } });
    expect(await db.profile.count({ where: { userId: malformed.userId } })).toBe(1);

    const { getDeckCandidateIds, canView } = await import("@/server/discovery/query");
    expect(await getDeckCandidateIds(db, { userId: viewer.userId }, { now: T0 })).not.toContain(malformed.userId);
    expect(await canView(db, viewer.userId, malformed.userId, T0)).toBe(false);

    // And it cannot be rendered as a profile or a Community author either.
    const { buildVisibleProfiles } = await import("@/server/profiles/visible-profile");
    expect(await buildVisibleProfiles(db, viewer.userId, [malformed.userId], T0)).toHaveLength(0);
  });

  it("staff cannot post to Community", async () => {
    const staff = await createStaff(db, { now: T0 });
    const { createPost } = await import("@/server/community/posts");
    await expect(createPost({ userId: staff.userId }, { kind: "TEXT", body: "hello from the admin team" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    expect(await db.communityPost.count({ where: { authorId: staff.userId } })).toBe(0);
  });
});

// ───────────────────────────── Conversion ─────────────────────────────

describe("MEMBER to STAFF conversion", () => {
  it("removes the dating account, keeps the history, and reports what it did", async () => {
    const member = await createUser(db, { now: T0 });
    await createIdentity(db, member.userId, { email: "converting@example.com" });
    // Give it the self-contained dating state a real account has.
    const other = await createUser(db, { now: T0 });
    await db.pass.create({ data: { fromUserId: member.userId, toUserId: other.userId, expiresAt: new Date(T0.getTime() + 86_400_000) } });
    const post = await db.communityPost.create({ data: { id: "post-under-test-0000000000000000", kind: "TEXT", body: "a post", authorId: member.userId, createdAt: T0 } });
    await db.communityComment.create({ data: { postId: post.id, authorId: other.userId, body: "someone else's reply", createdAt: T0 } });
    await db.auditLog.create({ data: { actorId: member.userId, action: "account.deleted", createdAt: T0 } });

    const before = await inventoryMemberData(db, member.userId);
    expect(before.profile).toBe(1);
    expect(planConversion(before).canProceed).toBe(true);

    const result = await promoteAccountToStaff(db, member.userId, { role: "MODERATOR", reason: "Joining the moderation team", via: "cli", actorId: null, now: T0 });

    const after = await db.user.findUniqueOrThrow({ where: { id: member.userId } });
    expect(after.accountType).toBe("STAFF");
    expect(after.role).toBe("MODERATOR");
    expect(after.onboardingCompletedAt).toBeNull();
    expect(after.dateOfBirth).toBeNull();
    expect(after.gender).toBeNull();

    const remaining = await inventoryMemberData(db, member.userId);
    expect(remaining.profile).toBe(0);
    expect(remaining.profilePhotos).toBe(0);
    expect(remaining.privacySettings).toBe(0);
    expect(remaining.discoveryPreferences).toBe(0);
    expect(remaining.verification).toBe(0);
    expect(remaining.passesGiven).toBe(0);
    expect(remaining.sessions).toBe(0);

    // History survives: the audit entry, the identity, and the other member's reply on the hidden post.
    expect(remaining.auditEntries).toBeGreaterThanOrEqual(before.auditEntries);
    expect(remaining.identities).toBe(before.identities);
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: post.id } })).deletedAt).not.toBeNull();
    expect(await db.communityComment.count({ where: { postId: post.id, authorId: other.userId, deletedAt: null } })).toBe(1);

    expect(result.orphanedStorageKeys.length).toBeGreaterThan(0); // the two seeded photos
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.staffConverted, targetId: member.userId } })).toBe(1);
    expect(await isLiveStaff(db, member.userId)).toBe(true);
  });

  it("refuses rather than destroying likes, matches, chats, reports or money", async () => {
    const member = await createUser(db, { now: T0 });
    await createIdentity(db, member.userId, { email: "entangled@example.com" });
    const other = await createUser(db, { now: T0 });
    await db.like.create({ data: { fromUserId: member.userId, toUserId: other.userId, createdAt: T0 } });

    const preview = await previewPromotion(db, member.userId);
    expect(preview.blockedReason).toContain("Likes given");
    await expect(promoteAccountToStaff(db, member.userId, { role: "ADMIN", reason: "Should refuse", via: "cli", actorId: null, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);

    // Nothing moved.
    const after = await db.user.findUniqueOrThrow({ where: { id: member.userId } });
    expect(after.accountType).toBe("MEMBER");
    expect(await db.profile.count({ where: { userId: member.userId } })).toBe(1);
    expect(await db.like.count({ where: { fromUserId: member.userId } })).toBe(1);
  });

  it("refuses an account with no verified email address", async () => {
    // §11: a Telegram-only account has no address the system has verified, so it cannot hold staff access.
    const member = await createUser(db, { now: T0 });
    await db.authIdentity.create({ data: { userId: member.userId, provider: "TELEGRAM", providerSubject: "tg-12345", displayName: "Someone", createdAt: T0 } });
    const preview = await previewPromotion(db, member.userId);
    expect(preview.email).toBeNull();
    expect(preview.blockedReason).toContain("no verified email");
    await expect(promoteAccountToStaff(db, member.userId, { role: "ADMIN", reason: "No address", via: "cli", actorId: null, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("an unverified address is not good enough either", async () => {
    const member = await createUser(db, { now: T0 });
    await db.authIdentity.create({ data: { userId: member.userId, provider: "EMAIL", providerSubject: "unconfirmed@example.com", email: "unconfirmed@example.com", emailVerified: false, createdAt: T0 } });
    expect((await previewPromotion(db, member.userId)).email).toBeNull();
  });

  it("is all-or-nothing: a failure part-way leaves the account untouched", async () => {
    const member = await createUser(db, { now: T0 });
    await createIdentity(db, member.userId, { email: "atomic@example.com" });
    // An open grant already exists for the address, so the transaction aborts after the conversion statements.
    const a = await admin();
    await createStaffGrant(a, { email: "atomic@example.com", role: "MODERATOR", reason: "Already authorised" }, { db, now: T0 });

    await expect(promoteAccountToStaff(db, member.userId, { role: "ADMIN", reason: "Should roll back", via: "cli", actorId: null, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    const after = await db.user.findUniqueOrThrow({ where: { id: member.userId } });
    expect(after.accountType).toBe("MEMBER");
    expect(await db.profile.count({ where: { userId: member.userId } })).toBe(1);
    expect(await db.privacySettings.count({ where: { userId: member.userId } })).toBe(1);
  });
});

// ───────────────────────────── Admin safety ─────────────────────────────

describe("administrator safety", () => {
  it("the last administrator cannot be revoked or demoted, even concurrently", async () => {
    const only = await createStaff(db, { role: "ADMIN", now: T0 });
    const second = await createStaff(db, { role: "ADMIN", now: T0 });
    const actor: AdminActor = { userId: second.userId, role: "ADMIN" };
    const otherActor: AdminActor = { userId: only.userId, role: "ADMIN" };
    expect(await countLiveAdmins(db)).toBe(2);

    // Two admins each trying to remove the other at the same time: exactly one may succeed.
    const results = await Promise.allSettled([
      revokeStaffGrant(actor, only.grantId, { reason: "Removing the other one" }, { db, now: T0 }),
      revokeStaffGrant(otherActor, second.grantId, { reason: "Removing the other one" }, { db, now: T0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await countLiveAdmins(db)).toBe(1);

    // And now the survivor cannot be removed at all. The remover is a real account (an admin whose own grant is
    // not live), because a refusal is itself audited and an audit row needs a real actor.
    const survivor = (await db.staffGrant.findFirstOrThrow({ where: { status: "ACTIVE", role: "ADMIN" } })).id;
    const spare = await createStaff(db, { role: "ADMIN", status: "PENDING", now: T0 });
    const remover: AdminActor = { userId: spare.userId, role: "ADMIN" };
    await expect(revokeStaffGrant(remover, survivor, { reason: "Last one out" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(changeStaffRole(remover, survivor, { role: "MODERATOR", reason: "Demote the last admin" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    expect(await countLiveAdmins(db)).toBe(1);
  });

  it("nobody revokes or demotes themselves, and the attempt is recorded", async () => {
    const a = await createStaff(db, { role: "ADMIN", now: T0 });
    await createStaff(db, { role: "ADMIN", now: T0 }); // so the last-admin rule is not what refuses
    const actor: AdminActor = { userId: a.userId, role: "ADMIN" };
    await expect(revokeStaffGrant(actor, a.grantId, { reason: "Removing myself" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(changeStaffRole(actor, a.grantId, { role: "MODERATOR", reason: "Demoting myself" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.staffChangeRejected } })).toBe(2);
  });

  it("a moderator cannot escalate anyone, including themselves", async () => {
    const mod = await admin("MODERATOR");
    const target = await createStaff(db, { role: "MODERATOR", now: T0 });
    await expect(changeStaffRole(mod, target.grantId, { role: "ADMIN", reason: "Escalate" }, { db, now: T0 })).rejects.toBeInstanceOf(AdminAccessError);
    await expect(revokeStaffGrant(mod, target.grantId, { reason: "Remove" }, { db, now: T0 })).rejects.toBeInstanceOf(AdminAccessError);
  });

  it("revoking does not turn the person back into a dating member", async () => {
    // §22: a revoked staff account must not suddenly become discoverable.
    const a = await admin();
    const victim = await createStaff(db, { role: "MODERATOR", now: T0 });
    await revokeStaffGrant(a, victim.grantId, { reason: "Left the team" }, { db, now: T0 });

    const after = await db.user.findUniqueOrThrow({ where: { id: victim.userId } });
    expect(after.accountType).toBe("STAFF"); // still not a dating account
    expect(after.role).toBe("USER"); // but with no authority
    expect(await db.profile.count({ where: { userId: victim.userId } })).toBe(0);
    expect(await isLiveStaff(db, victim.userId)).toBe(false);
  });
});

// ───────────────────────────── Audit ─────────────────────────────

describe("staff audit trail", () => {
  it("records the whole lifecycle and never a credential", async () => {
    const a = await admin();
    const grant = await createStaffGrant(a, { email: "audited@example.com", role: "MODERATOR", reason: "Audit coverage" }, { db, now: T0 });
    const claimed = await claimStaffInvite({ token: grant.token, password: PASSWORD }, { db, now: T0 });
    expect(claimed.ok).toBe(true);
    await changeStaffRole(a, grant.grantId, { role: "ADMIN", reason: "Promoted to admin" }, { db, now: T0 });
    await revokeStaffGrant(a, grant.grantId, { reason: "Left the team" }, { db, now: T0 });

    const actions = (await db.auditLog.findMany({ select: { action: true } })).map((r) => r.action);
    for (const expected of [AUDIT_ACTIONS.staffInvited, AUDIT_ACTIONS.staffClaimed, AUDIT_ACTIONS.staffActivated, AUDIT_ACTIONS.staffPasswordSet, AUDIT_ACTIONS.staffRoleChanged, AUDIT_ACTIONS.staffRevoked]) {
      expect(actions, expected).toContain(expected);
    }
    const roleChange = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.staffRoleChanged } });
    expect(roleChange.data).toMatchObject({ reason: "Promoted to admin", before: { role: "MODERATOR" }, after: { role: "ADMIN" } });

    // No password, no token, no hash anywhere in the trail.
    const everything = JSON.stringify(await db.auditLog.findMany());
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain(grant.token);
    expect(everything).not.toContain("scrypt$");
  });
});

describe("email normalisation", () => {
  it("trims and lowercases, and nothing else", () => {
    expect(normalizeStaffEmail("  Person@Example.COM  ")).toBe("person@example.com");
    // Deliberately not folded: plus-addressing and dots mean different things at different providers, and
    // guessing would either merge two real people or slip past the one-open-grant-per-address index.
    expect(normalizeStaffEmail("a.b+tag@example.com")).toBe("a.b+tag@example.com");
    expect(normalizeStaffEmail(null)).toBe("");
  });
});

describe("staff account creation primitive", () => {
  it("writes a User row and nothing from the dating domain", async () => {
    const account = await createStaffAccount(db, "ADMIN", T0);
    const inv = await inventoryMemberData(db, account.id);
    // Compare against a member, which gets four settings rows at creation.
    const member = await createUser(db, { now: T0 });
    const memberInv = await inventoryMemberData(db, member.userId);
    expect(memberInv.privacySettings + memberInv.discoveryPreferences + memberInv.notificationSettings + memberInv.verification).toBe(4);
    expect(inv.privacySettings + inv.discoveryPreferences + inv.notificationSettings + inv.verification).toBe(0);
    expect(inv.profile).toBe(0);
  });
});

describe("staff cannot reach the dating domain, even calling the domain functions directly", () => {
  // §16: the request-level guard (requireMember) is what the app relies on, but the domain functions assert it
  // too, so a future action or script that forgets cannot create dating state for an operational account.
  it("refuses likes, passes, boosts, Plus orders, comments and reactions", async () => {
    const staff = await createStaff(db, { now: T0 });
    const member = await createUser(db, { now: T0 });
    const actor = { userId: staff.userId };

    const { likeUser, passUser } = await import("@/server/likes/like");
    const { activateBoost } = await import("@/server/boosts/boost");
    const { createOrder } = await import("@/server/billing/orders");
    const { addComment } = await import("@/server/community/comments");
    const { setReaction } = await import("@/server/community/reactions");
    const { StaffInMemberDomainError } = await import("@/server/members/guard");

    const post = await db.communityPost.create({ data: { id: "staff-isolation-post-00000000000", kind: "TEXT", body: "a member post", authorId: member.userId, createdAt: T0 } });

    await expect(likeUser(actor, member.userId, { db, now: T0 })).rejects.toBeInstanceOf(StaffInMemberDomainError);
    await expect(passUser(actor, member.userId, { db, now: T0 })).rejects.toBeInstanceOf(StaffInMemberDomainError);
    await expect(activateBoost(actor, { db, now: T0 })).rejects.toBeInstanceOf(StaffInMemberDomainError);
    await expect(createOrder(actor, { planId: "anything" }, { db, now: T0 })).rejects.toBeInstanceOf(StaffInMemberDomainError);
    await expect(addComment(actor, post.id, "hello", { db, now: T0 })).rejects.toBeInstanceOf(StaffInMemberDomainError);
    await expect(setReaction(actor, post.id, true, { db, now: T0 })).rejects.toBeInstanceOf(StaffInMemberDomainError);

    // Nothing was written by any of them.
    expect(await db.like.count({ where: { fromUserId: staff.userId } })).toBe(0);
    expect(await db.pass.count({ where: { fromUserId: staff.userId } })).toBe(0);
    expect(await db.boost.count({ where: { userId: staff.userId } })).toBe(0);
    expect(await db.subscriptionOrder.count({ where: { userId: staff.userId } })).toBe(0);
    expect(await db.communityComment.count({ where: { authorId: staff.userId } })).toBe(0);
    expect(await db.communityLike.count({ where: { userId: staff.userId } })).toBe(0);
  });

  it("refuses dating messages", async () => {
    // A staff account cannot be in a conversation at all, but assert the send path refuses regardless.
    const staff = await createStaff(db, { now: T0 });
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    const conversation = await db.conversation.create({ data: { userAId: a.userId, userBId: b.userId, status: "ACTIVE", createdAt: T0 } });
    const { sendMessage } = await import("@/server/conversations/messages");
    const { StaffInMemberDomainError } = await import("@/server/members/guard");
    await expect(sendMessage({ userId: staff.userId }, conversation.id, "hello", { db, now: T0 })).rejects.toBeInstanceOf(StaffInMemberDomainError);
    expect(await db.message.count({ where: { senderId: staff.userId } })).toBe(0);
  });

  it("is not listed in the member directory or counted in the member metrics", async () => {
    const a = await admin();
    await createUser(db, { now: T0 });
    const { searchUsers } = await import("@/server/admin/users");
    const { getDashboardMetrics } = await import("@/server/admin/metrics");
    const found = await searchUsers(a, {}, { db, now: T0 });
    expect(found.items.map((r) => r.userId)).not.toContain(a.userId);
    expect(found.total).toBe(1);
    expect((await getDashboardMetrics({ db, now: T0 })).users.total).toBe(1);
  });
});

describe("member self-service refuses an operational account", () => {
  it("member account deletion refuses a staff account outright", async () => {
    // Browser verification prompted this: the deletion action read the session directly and accepted any
    // non-anonymous state, so a staff session could reach a flow that anonymises a dating profile. The action now
    // refuses it, and so does the domain function underneath.
    const staff = await createStaff(db, { now: T0 });
    const { createSession } = await import("@/server/auth/session");
    const session = await createSession(db, staff.userId, {}, T0);
    const resolved = await (await import("@/server/auth/session")).resolveSession(db, session.token, T0);
    expect(resolved?.user.accountType).toBe("STAFF");

    const { deleteAccount } = await import("@/server/users/deletion");
    const { StaffInMemberDomainError } = await import("@/server/members/guard");
    const storage = { id: "test", put: async () => {}, delete: async () => {}, read: async () => null, getReadUrl: async () => "" };
    await expect(deleteAccount({ userId: staff.userId }, { sessionId: resolved!.sessionId }, { db, storage, now: T0 })).rejects.toBeInstanceOf(StaffInMemberDomainError);
    expect((await db.user.findUniqueOrThrow({ where: { id: staff.userId } })).status).toBe("ACTIVE");
  });
});

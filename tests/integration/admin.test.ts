/**
 * Admin authorization, user operations, bootstrap, moderation, verification and audit (docs/ARCHITECTURE.md §21).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { AUDIT_ACTIONS } from "@/server/admin/audit";
import { listAuditLog } from "@/server/admin/audit-list";
import { AdminAccessError, assertPermission, type AdminActor } from "@/server/admin/authz";
import { bootstrapFirstAdmin, changeUserRole, countAdmins, isBootstrapAvailable } from "@/server/admin/bootstrap";
import { getDashboardMetrics } from "@/server/admin/metrics";
import { decideReport, getReportDetail, listReports } from "@/server/admin/moderation";
import { getUserDetail, searchUsers, setAccountStatus } from "@/server/admin/users";
import { decideVerification, listVerificationQueue } from "@/server/admin/verification";
import { createSession, resolveSession } from "@/server/auth/session";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createIdentity, createUser, grantPlus, hours } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-18T00:00:00Z");
const TOKEN = "bootstrap-token-0123456789abcdef0123456789abcdef";

async function makeAdmin(role: "ADMIN" | "MODERATOR" = "ADMIN"): Promise<AdminActor> {
  const u = await createUser(db, { now: T0 });
  await db.user.update({ where: { id: u.userId }, data: { role } });
  return { userId: u.userId, role };
}

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("admin authorization", () => {
  it("moderators are refused the permissions they lack; role is checked per permission", () => {
    const mod: AdminActor = { userId: "m", role: "MODERATOR" };
    expect(() => assertPermission(mod, "payments.review")).toThrow(AdminAccessError);
    expect(() => assertPermission(mod, "plans.manage")).toThrow(AdminAccessError);
    expect(() => assertPermission(mod, "users.role")).toThrow(AdminAccessError);
    expect(() => assertPermission(mod, "reports.act")).not.toThrow();
  });
  it("a plain user's session never yields an admin actor, whatever the client claims", async () => {
    const { adminActorFrom } = await import("@/server/admin/authz");
    const u = await createUser(db, { now: T0 });
    const row = await db.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(adminActorFrom(row)).toBeNull();
    // A forged role in a payload is irrelevant: only the row matters.
    expect(adminActorFrom({ ...row, role: "ADMIN" })).toEqual({ userId: u.userId, role: "ADMIN" });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.userId } })).role).toBe("USER");
  });
  it("domain functions refuse a non-admin actor object outright", async () => {
    const u = await createUser(db, { now: T0 });
    const fake = { userId: u.userId, role: "USER" as unknown as "ADMIN" };
    await expect(searchUsers(fake, {}, { db, now: T0 })).rejects.toBeInstanceOf(Error);
  });
});

describe("bootstrap", () => {
  it("only while no admin exists, only with the exact token, audited, then self-disables", async () => {
    const owner = await createUser(db, { now: T0 });
    expect(await isBootstrapAvailable(db)).toBe(false); // token not configured in tests
    expect(await bootstrapFirstAdmin(owner, TOKEN, { db, now: T0, token: null })).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(await bootstrapFirstAdmin(owner, "wrong-token-0123456789abcdef0123456789abcdef", { db, now: T0, token: TOKEN })).toEqual({ ok: false, code: "INVALID_TOKEN" });
    expect(await bootstrapFirstAdmin(owner, TOKEN, { db, now: T0, token: TOKEN })).toEqual({ ok: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).role).toBe("ADMIN");
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.adminBootstrapped, targetId: owner.userId } })).toBe(1);
    const second = await createUser(db, { now: T0 });
    expect(await bootstrapFirstAdmin(second, TOKEN, { db, now: T0, token: TOKEN })).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(await countAdmins(db)).toBe(1);
  });
  it("rate-limits guesses and refuses accounts that have not finished onboarding", async () => {
    const guesser = await createUser(db, { now: T0 });
    for (let i = 0; i < 5; i += 1) expect((await bootstrapFirstAdmin(guesser, "x".repeat(40), { db, now: T0, token: TOKEN })).ok).toBe(false);
    expect(await bootstrapFirstAdmin(guesser, TOKEN, { db, now: T0, token: TOKEN })).toEqual({ ok: false, code: "RATE_LIMITED" });
    const onboarding = await createUser(db, { now: T0, status: "ONBOARDING" });
    expect(await bootstrapFirstAdmin(onboarding, TOKEN, { db, now: T0, token: TOKEN })).toEqual({ ok: false, code: "NOT_ELIGIBLE" });
  });
});

describe("roles", () => {
  it("ADMIN changes roles with a reason and audit; never own role; never the last admin", async () => {
    const admin = await makeAdmin();
    const u = await createUser(db, { now: T0 });
    await expect(changeUserRole(admin, u.userId, { role: "MODERATOR", reason: "" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    expect(await changeUserRole(admin, u.userId, { role: "MODERATOR", reason: "Trusted volunteer" }, { db, now: T0 })).toEqual({ userId: u.userId, role: "MODERATOR" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.adminRoleChanged, targetId: u.userId } });
    expect(audit.actorId).toBe(admin.userId);
    expect(audit.data).toMatchObject({ reason: "Trusted volunteer", before: { role: "USER" }, after: { role: "MODERATOR" } });
    await expect(changeUserRole(admin, admin.userId, { role: "USER", reason: "demote self" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    const other = await makeAdmin();
    await changeUserRole(admin, other.userId, { role: "USER", reason: "leaving" }, { db, now: T0 });
    // The demoted account no longer yields an admin actor from its row, so requireAdmin() would refuse it.
    const { adminActorFrom } = await import("@/server/admin/authz");
    expect(adminActorFrom(await db.user.findUniqueOrThrow({ where: { id: other.userId } }))).toBeNull();
    await expect(changeUserRole(admin, admin.userId, { role: "USER", reason: "last admin" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    const mod = await makeAdmin("MODERATOR");
    await expect(changeUserRole(mod, u.userId, { role: "ADMIN", reason: "escalate" }, { db, now: T0 })).rejects.toBeInstanceOf(AdminAccessError);
  });
});

describe("account status", () => {
  it("suspend signs the person out, unsuspend restores, ban is recorded; every step audited with a reason", async () => {
    const admin = await makeAdmin();
    const u = await createUser(db, { now: T0 });
    const session = await createSession(db, u.userId, { ip: null, userAgent: null }, T0);
    await expect(setAccountStatus(admin, u.userId, { action: "SUSPEND", reason: "" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    expect(await setAccountStatus(admin, u.userId, { action: "SUSPEND", reason: "Harassment report upheld" }, { db, now: T0 })).toEqual({ userId: u.userId, status: "SUSPENDED" });
    expect(await resolveSession(db, session.token, at(T0, 1000))).toBeNull();
    expect(await setAccountStatus(admin, u.userId, { action: "UNSUSPEND", reason: "Appeal accepted" }, { db, now: T0 })).toEqual({ userId: u.userId, status: "ACTIVE" });
    expect(await setAccountStatus(admin, u.userId, { action: "BAN", reason: "Repeat offence" }, { db, now: T0 })).toEqual({ userId: u.userId, status: "BANNED" });
    const actions = (await db.auditLog.findMany({ where: { targetId: u.userId }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual([AUDIT_ACTIONS.userSuspended, AUDIT_ACTIONS.userUnsuspended, AUDIT_ACTIONS.userBanned]);
    const ban = await db.auditLog.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.userBanned } });
    expect(ban.data).toMatchObject({ reason: "Repeat offence", before: { status: "ACTIVE" }, after: { status: "BANNED" } });
  });
  it("protects self, admins, deleted accounts and enforces valid transitions", async () => {
    const admin = await makeAdmin();
    const other = await makeAdmin();
    const mod = await makeAdmin("MODERATOR");
    const u = await createUser(db, { now: T0 });
    await expect(setAccountStatus(admin, admin.userId, { action: "SUSPEND", reason: "oops" }, { db })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(setAccountStatus(admin, other.userId, { action: "BAN", reason: "not allowed" }, { db })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(setAccountStatus(mod, admin.userId, { action: "BAN", reason: "not allowed" }, { db })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(setAccountStatus(admin, u.userId, { action: "UNSUSPEND", reason: "not suspended" }, { db })).rejects.toBeInstanceOf(InvalidStateError);
    await db.user.update({ where: { id: u.userId }, data: { status: "DELETED" } });
    await expect(setAccountStatus(admin, u.userId, { action: "BAN", reason: "gone" }, { db })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(setAccountStatus(admin, "nope", { action: "BAN", reason: "gone" }, { db })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("user directory and detail", () => {
  it("searches by name, handle and id with filters, and the detail exposes no secrets", async () => {
    const admin = await makeAdmin();
    const a = await createUser(db, { now: T0, name: "Aishath Test" });
    const b = await createUser(db, { now: T0, name: "Hassan Test", status: "ONBOARDING" });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await createIdentity(db, a.userId, { email: "aishath@example.com" });
    const byName = await searchUsers(admin, { q: "aishath" }, { db, now: T0 });
    expect(byName.items.map((u) => u.userId)).toEqual([a.userId]);
    expect(byName.items[0]).toMatchObject({ tier: "PLUS", onboardingComplete: true, status: "ACTIVE" });
    expect((await searchUsers(admin, { q: a.handle }, { db, now: T0 })).total).toBe(1);
    expect((await searchUsers(admin, { q: b.userId }, { db, now: T0 })).items[0]?.status).toBe("ONBOARDING");
    expect((await searchUsers(admin, { membership: "plus" }, { db, now: T0 })).total).toBe(1);
    expect((await searchUsers(admin, { onboarding: "incomplete" }, { db, now: T0 })).items.map((u) => u.userId)).toEqual([b.userId]);
    const detail = await getUserDetail(admin, a.userId, { db, now: T0 });
    expect(detail.account.hasPhone).toBe(true);
    expect(detail.signIn).toMatchObject({ provider: "GOOGLE", account: "aishath@example.com" });
    expect(detail.membership.tier).toBe("PLUS");
    const json = JSON.stringify(detail);
    expect(json).not.toMatch(/phoneE164|phoneHash|tokenHash|providerSubject|selfieStorageKey|codeVerifier|secret/i);
    expect(json).not.toContain(a.phoneE164);
    await expect(getUserDetail(admin, "missing", { db })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("moderation queue", () => {
  it("lists open reports, enforces decision transitions and audits every decision", async () => {
    const admin = await makeAdmin("MODERATOR");
    const reporter = await createUser(db, { now: T0 });
    const target = await createUser(db, { now: T0 });
    const report = await db.report.create({ data: { reporterId: reporter.userId, targetUserId: target.userId, reason: "HARASSMENT", note: "Kept messaging", snapshot: { conversationId: "c", messages: [] }, createdAt: T0 } });
    expect((await listReports(admin, { filter: "open" }, { db })).items.map((r) => r.id)).toEqual([report.id]);
    const detail = await getReportDetail(admin, report.id, { db });
    expect(detail.target.userId).toBe(target.userId);
    expect(detail.note).toBe("Kept messaging");
    await expect(decideReport(admin, report.id, { status: "RESOLVED", resolution: "" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await decideReport(admin, report.id, { status: "UNDER_REVIEW" }, { db, now: T0 });
    await expect(decideReport(admin, report.id, { status: "UNDER_REVIEW" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    const resolved = await decideReport(admin, report.id, { status: "RESOLVED", resolution: "Suspended the account" }, { db, now: at(T0, 1000) });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedAt).not.toBeNull();
    await expect(decideReport(admin, report.id, { status: "DISMISSED" }, { db })).rejects.toBeInstanceOf(InvalidStateError);
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.reportDecided, targetId: report.id } })).toBe(2);
    expect((await listReports(admin, { filter: "open" }, { db })).total).toBe(0);
  });
});

describe("verification queue", () => {
  it("cannot verify anyone without a submitted selfie; with one, decides, notifies and audits", async () => {
    const admin = await makeAdmin("MODERATOR");
    const u = await createUser(db, { now: T0 });
    await db.verification.update({ where: { userId: u.userId }, data: { status: "UNDER_REVIEW", submittedAt: T0 } });
    expect((await listVerificationQueue(admin, { db })).items[0]).toMatchObject({ userId: u.userId, hasSelfie: false });
    await expect(decideVerification(admin, u.userId, { decision: "VERIFIED" }, { db, now: T0 })).rejects.toBeInstanceOf(InvalidStateError);
    expect((await db.verification.findUniqueOrThrow({ where: { userId: u.userId } })).status).toBe("UNDER_REVIEW");
    await db.verification.update({ where: { userId: u.userId }, data: { selfieStorageKey: `verification/${u.userId}/selfie.webp` } });
    await expect(decideVerification(admin, u.userId, { decision: "REJECTED", reason: "" }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    expect(await decideVerification(admin, u.userId, { decision: "VERIFIED" }, { db, now: T0 })).toEqual({ userId: u.userId, status: "VERIFIED" });
    expect(await db.notification.count({ where: { userId: u.userId, type: "VERIFICATION_UPDATE" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.verificationDecided, targetId: u.userId } })).toBe(1);
    await expect(decideVerification(admin, u.userId, { decision: "REJECTED", reason: "again" }, { db })).rejects.toBeInstanceOf(InvalidStateError);
    // Google sign-in alone never counts: a fresh account stays NONE.
    const fresh = await createUser(db, { now: T0 });
    await createIdentity(db, fresh.userId);
    expect((await db.verification.findUniqueOrThrow({ where: { userId: fresh.userId } })).status).toBe("NONE");
  });
});

describe("metrics and audit log", () => {
  it("counts from canonical rows with the documented definitions", async () => {
    const admin = await makeAdmin();
    const old = await createUser(db, { now: at(T0, -hours(48)) });
    const onboarding = await createUser(db, { now: T0, status: "ONBOARDING" });
    const paused = await createUser(db, { now: T0 });
    await db.privacySettings.update({ where: { userId: paused.userId }, data: { pausedAt: T0 } });
    const plus = await createUser(db, { now: T0 });
    await grantPlus(db, plus.userId, at(T0, -hours(1)), at(T0, hours(24)));
    // The factory leaves createdAt at the database default; pin the creation times this test reasons about.
    await db.user.updateMany({ where: { id: { in: [admin.userId, onboarding.userId, paused.userId, plus.userId] } }, data: { createdAt: T0 } });
    await db.user.update({ where: { id: old.userId }, data: { createdAt: at(T0, -hours(48)) } });
    const m = await getDashboardMetrics({ db, now: at(T0, hours(6)) }); // 06:00 UTC = 11:00 Maldives; day started 19:00 UTC yesterday
    expect(m.users.total).toBe(5);
    expect(m.users.onboarding).toBe(1);
    expect(m.users.completedProfiles).toBe(4);
    expect(m.users.newToday).toBe(4); // everyone created at T0; the 48h-old one is excluded
    expect(m.users.new7d).toBe(5);
    expect(m.users.paused).toBe(1);
    expect(m.membership.plusNow).toBe(1);
    expect(m.safety.openReports).toBe(0);
    expect(onboarding.userId).toBeTruthy();
    const log = await listAuditLog(admin, {}, { db });
    expect(log.total).toBe(0);
  });
});

import { existsSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { VERIFY_HREF } from "@/lib/verification-reminder";
import { getVerificationReminder, reminderDismissKey } from "@/server/verification/reminder";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { createStaff, createUser } from "../helpers/factory";

/*
 * The Discover verification reminder: WHO sees it, decided on the server from the Verification row
 * (src/server/verification/reminder.ts). The seven-day snooze is tested in tests/unit/verification-reminder.test.ts.
 */
const db = testDb();
const T0 = new Date("2026-09-25T06:00:00Z");
const HOUR = 3_600_000;

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

const setStatus = (userId: string, status: "NONE" | "PHONE_VERIFIED" | "SELFIE_SUBMITTED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED", decidedAt: Date | null = null) =>
  db.verification.update({ where: { userId }, data: { status, decidedAt } });

describe("who is reminded to verify", () => {
  it("an unverified member is reminded", async () => {
    const me = await createUser(db, { now: T0 });
    expect(await getVerificationReminder(db, me.userId, T0)).toEqual({ dismissKey: reminderDismissKey(me.userId) });
  });

  it("the legacy PHONE_VERIFIED status counts as unverified", async () => {
    const me = await createUser(db, { now: T0 });
    await setStatus(me.userId, "PHONE_VERIFIED");
    expect(await getVerificationReminder(db, me.userId, T0)).not.toBeNull();
  });

  it("a member with no Verification row yet is reminded, and the check does not create one", async () => {
    const me = await createUser(db, { now: T0 });
    await db.verification.delete({ where: { userId: me.userId } });
    expect(await getVerificationReminder(db, me.userId, T0)).not.toBeNull();
    expect(await db.verification.count({ where: { userId: me.userId } })).toBe(0);
  });

  it("a verified member is not reminded", async () => {
    const me = await createUser(db, { now: T0, verified: true });
    expect(await getVerificationReminder(db, me.userId, T0)).toBeNull();
  });

  it("a pending verification is not asked to verify again (both pending statuses)", async () => {
    const me = await createUser(db, { now: T0 });
    await setStatus(me.userId, "SELFIE_SUBMITTED");
    expect(await getVerificationReminder(db, me.userId, T0)).toBeNull();
    await setStatus(me.userId, "UNDER_REVIEW");
    expect(await getVerificationReminder(db, me.userId, T0)).toBeNull();
  });

  it("a rejected member is reminded only once they are allowed to try again (24 h after the decision)", async () => {
    const me = await createUser(db, { now: T0 });
    await setStatus(me.userId, "REJECTED", new Date(T0.getTime() - 2 * HOUR));
    expect(await getVerificationReminder(db, me.userId, T0)).toBeNull();
    await setStatus(me.userId, "REJECTED", new Date(T0.getTime() - 25 * HOUR));
    expect(await getVerificationReminder(db, me.userId, T0)).not.toBeNull();
  });

  it("becoming verified stops the reminder immediately, whatever the browser remembers", async () => {
    const me = await createUser(db, { now: T0 });
    expect(await getVerificationReminder(db, me.userId, T0)).not.toBeNull();
    await setStatus(me.userId, "VERIFIED", T0);
    expect(await getVerificationReminder(db, me.userId, T0)).toBeNull();
  });

  it("staff accounts, and members holding a staff role, are never reminded", async () => {
    const staff = await createStaff(db, { now: T0 });
    expect(await getVerificationReminder(db, staff.userId, T0)).toBeNull();
    const member = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: member.userId }, data: { role: "ADMIN" } });
    expect(await getVerificationReminder(db, member.userId, T0)).toBeNull();
  });

  it("accounts that are onboarding, suspended, deleted or missing are not reminded", async () => {
    const onboarding = await createUser(db, { now: T0, status: "ONBOARDING" });
    expect(await getVerificationReminder(db, onboarding.userId, T0)).toBeNull();
    const suspended = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: suspended.userId }, data: { status: "SUSPENDED" } });
    expect(await getVerificationReminder(db, suspended.userId, T0)).toBeNull();
    const deleted = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: deleted.userId }, data: { deletedAt: T0 } });
    expect(await getVerificationReminder(db, deleted.userId, T0)).toBeNull();
    expect(await getVerificationReminder(db, "no-such-user", T0)).toBeNull();
  });
});

describe("the dismissal key", () => {
  it("is stable per member, different between members, and never carries the member id", async () => {
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    expect(reminderDismissKey(a.userId)).toBe(reminderDismissKey(a.userId));
    expect(reminderDismissKey(a.userId)).not.toBe(reminderDismissKey(b.userId));
    expect(reminderDismissKey(a.userId)).not.toContain(a.userId);
  });
});

describe("Verify now", () => {
  it("opens the existing verification flow", () => {
    expect(VERIFY_HREF).toBe("/settings/verification");
    expect(existsSync("src/app/(app)/settings/verification/page.tsx")).toBe(true);
  });
});

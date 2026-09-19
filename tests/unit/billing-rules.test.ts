import { describe, expect, it } from "vitest";
import { InvalidStateError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { adminActorFrom, hasPermission, ROLE_PERMISSIONS } from "@/server/admin/authz";
import { sanitizeAuditData } from "@/server/admin/audit";
import { startOfMaldivesDay } from "@/server/admin/metrics";
import { generateReference, isPaymentReference, normalizeReference, REFERENCE_ALPHABET } from "@/server/billing/reference";
import { assertTransition, canTransition, ORDER_TRANSITIONS } from "@/server/billing/state";

describe("payment references", () => {
  it("are THU- plus six unambiguous characters and never sequential", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const r = generateReference();
      expect(r).toMatch(/^THU-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      expect(isPaymentReference(r)).toBe(true);
      seen.add(r);
    }
    expect(seen.size).toBeGreaterThan(1990);
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OI]/);
  });
  it("normalises what a customer types", () => {
    expect(normalizeReference(" thu 7k4p2m ")).toBe("THU-7K4P2M");
    expect(normalizeReference("THU-7K4P2M")).toBe("THU-7K4P2M");
    expect(normalizeReference("THU-7K4P2")).toBeNull();
    expect(normalizeReference("THU-0OII11")).toBeNull();
  });
});

describe("order state machine", () => {
  it("allows only the documented edges", () => {
    expect(canTransition("AWAITING_PAYMENT", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTED", "APPROVED")).toBe(true);
    expect(canTransition("SUBMITTED", "REJECTED")).toBe(true);
    expect(canTransition("APPROVED", "SUBMITTED")).toBe(false);
    expect(canTransition("APPROVED", "REJECTED")).toBe(false);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
    expect(canTransition("AWAITING_PAYMENT", "APPROVED")).toBe(false);
    for (const terminal of ["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"] as const) expect(ORDER_TRANSITIONS[terminal]).toEqual([]);
    expect(() => assertTransition("APPROVED", "SUBMITTED")).toThrow(InvalidStateError);
  });
});

describe("admin permissions", () => {
  it("gives ADMIN everything and MODERATOR only safety surfaces", () => {
    expect(hasPermission("ADMIN", "payments.review")).toBe(true);
    expect(hasPermission("ADMIN", "users.role")).toBe(true);
    expect(hasPermission("MODERATOR", "reports.act")).toBe(true);
    expect(hasPermission("MODERATOR", "payments.review")).toBe(false);
    expect(hasPermission("MODERATOR", "plans.manage")).toBe(false);
    expect(hasPermission("MODERATOR", "users.role")).toBe(false);
    expect(ROLE_PERMISSIONS.MODERATOR.length).toBeLessThan(ROLE_PERMISSIONS.ADMIN.length);
  });
  it("derives the admin actor from the database row only", () => {
    const base = { id: "u1", accountType: "STAFF", status: "ACTIVE" };
    expect(adminActorFrom({ ...base, role: "ADMIN" })).toEqual({ userId: "u1", role: "ADMIN" });
    expect(adminActorFrom({ ...base, role: "MODERATOR" })).toEqual({ userId: "u1", role: "MODERATOR" });
    expect(adminActorFrom({ ...base, role: "USER" })).toBeNull();
    expect(adminActorFrom({ ...base, role: "admin" })).toBeNull();
    expect(adminActorFrom({ ...base, role: "ADMIN", status: "SUSPENDED" })).toBeNull();
    expect(adminActorFrom(null)).toBeNull();
  });

  it("refuses a dating member however its role column reads", () => {
    // The account-type test is what keeps authority from leaking back into the member domain: a stale row, a bad
    // migration or a direct database edit that sets role=ADMIN on a MEMBER must still get nothing.
    expect(adminActorFrom({ id: "u1", accountType: "MEMBER", status: "ACTIVE", role: "ADMIN" })).toBeNull();
    expect(adminActorFrom({ id: "u1", accountType: "MEMBER", status: "ACTIVE", role: "MODERATOR" })).toBeNull();
    // A missing account type is treated as "not staff" rather than defaulting open.
    expect(adminActorFrom({ id: "u1", status: "ACTIVE", role: "ADMIN" })).toBeNull();
  });

  it("does not require onboarding, because staff never do it", () => {
    expect(adminActorFrom({ id: "u1", accountType: "STAFF", status: "ACTIVE", role: "ADMIN" })).toEqual({ userId: "u1", role: "ADMIN" });
  });
});

describe("audit sanitiser", () => {
  it("drops secret-looking keys recursively and keeps the rest", () => {
    const out = sanitizeAuditData({ reason: "x", token: "t", nested: { providerSubject: "s", ok: 1, sessionTokenHash: "h" }, list: [{ apiKey: "k", keep: true }], when: new Date("2026-01-01T00:00:00Z") }) as Record<string, unknown>;
    expect(out).toEqual({ reason: "x", nested: { ok: 1 }, list: [{ keep: true }], when: "2026-01-01T00:00:00.000Z" });
  });
});

describe("formatting and calendar", () => {
  it("formats MVR minor units", () => {
    expect(formatMoney(14900, "MVR")).toBe("MVR 149");
    expect(formatMoney(14950, "MVR")).toBe("MVR 149.50");
  });
  it("starts the Maldives day at 19:00 UTC the previous evening", () => {
    expect(startOfMaldivesDay(new Date("2026-09-18T03:00:00Z")).toISOString()).toBe("2026-09-17T19:00:00.000Z");
    expect(startOfMaldivesDay(new Date("2026-09-17T18:59:00Z")).toISOString()).toBe("2026-09-16T19:00:00.000Z");
  });
});

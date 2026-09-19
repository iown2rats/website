import { describe, expect, it } from "vitest";
import { PRODUCT_RULES, USAGE_WINDOWS } from "@/config/product";
import { ageFromDateOfBirth, isAdult } from "@/lib/age";

describe("product rules (approved 2026-09-17)", () => {
  it("encode the approved Free and Plus values", () => {
    expect(PRODUCT_RULES.FREE.dailyLikeLimit).toBe(30);
    expect(PRODUCT_RULES.PLUS.dailyLikeLimit).toBe(90);
    expect(PRODUCT_RULES.FREE.canSeeIncomingLikes).toBe(false);
    expect(PRODUCT_RULES.PLUS.canSeeIncomingLikes).toBe(true);
    expect(PRODUCT_RULES.FREE.canUseInvisibleMode).toBe(false);
    expect(PRODUCT_RULES.PLUS.canUseInvisibleMode).toBe(true);
    expect(PRODUCT_RULES.FREE.boostsPerWindow).toBe(0);
    expect(PRODUCT_RULES.PLUS.boostsPerWindow).toBe(2);
    expect(PRODUCT_RULES.PLUS.canUndoPass).toBe(true);
    // Messaging a match is unlimited on every tier, so there is deliberately no tier field for it: a cooldown
    // cannot be reintroduced by editing a value (docs/ARCHITECTURE.md §12.4).
    expect(PRODUCT_RULES.FREE).not.toHaveProperty("messageCooldownMs");
    expect(PRODUCT_RULES.PLUS).not.toHaveProperty("messageCooldownMs");
    expect(USAGE_WINDOWS.LIKES).toBe(24 * 3_600_000);
    expect(USAGE_WINDOWS.BOOSTS).toBe(7 * 24 * 3_600_000);
  });
});

describe("age", () => {
  const now = new Date("2026-09-17T00:00:00Z");
  it("computes whole years and handles the day before a birthday", () => {
    expect(ageFromDateOfBirth(new Date("2008-09-17"), now)).toBe(18);
    expect(ageFromDateOfBirth(new Date("2008-09-18"), now)).toBe(17);
    expect(ageFromDateOfBirth(new Date("1999-03-14"), now)).toBe(27);
  });
  it("rejects under-18 and accepts exactly 18", () => {
    expect(isAdult(new Date("2008-09-18"), now)).toBe(false);
    expect(isAdult(new Date("2008-09-17"), now)).toBe(true);
  });
  it("handles leap-day birthdays", () => {
    expect(ageFromDateOfBirth(new Date("2008-02-29"), new Date("2026-02-28T00:00:00Z"))).toBe(17);
    expect(ageFromDateOfBirth(new Date("2008-02-29"), new Date("2026-03-01T00:00:00Z"))).toBe(18);
  });
});

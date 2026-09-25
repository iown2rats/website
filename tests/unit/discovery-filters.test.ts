import { describe, expect, it } from "vitest";
import { DISCOVERY } from "@/config/product";
import { ageRangeWarning, rememberedFriendship, resetFilterValues, showMeForMode } from "@/lib/discovery-filters";

/* The Filters sheet's decisions (src/lib/discovery-filters.ts). The server enforces every rule regardless. */
describe("Filters sheet: mode switching", () => {
  it("restores each mode's own Show me across Dating → Friendship → Dating → Friendship", () => {
    const dto = { connectionIntent: "DATING" as const, interestedIn: "WOMEN" as const, friendshipInterestedIn: "EVERYONE" as const };
    const friendship = rememberedFriendship(dto);
    const seq = (["FRIENDSHIP", "DATING", "FRIENDSHIP", "DATING"] as const).map((m) => showMeForMode(m, "WOMEN", friendship));
    expect(seq).toEqual(["EVERYONE", "WOMEN", "EVERYONE", "WOMEN"]);
  });

  it("never hands the Dating-derived value to Friendship when nothing is remembered: the member is asked", () => {
    expect(rememberedFriendship({ connectionIntent: "DATING", interestedIn: "WOMEN", friendshipInterestedIn: null })).toBeNull();
    expect(showMeForMode("FRIENDSHIP", "WOMEN", null)).toBeNull();
  });

  it("uses the Friendship value in force when the member is already on Friendship", () => {
    expect(rememberedFriendship({ connectionIntent: "FRIENDSHIP", interestedIn: "MEN", friendshipInterestedIn: null })).toBe("MEN");
  });
});

describe("Filters sheet: Reset", () => {
  it("returns the age range to THE canonical default, 18–60", () => {
    expect(resetFilterValues("DATING", "MARRIAGE")).toMatchObject({ ageMin: DISCOVERY.defaultAgeRange.min, ageMax: DISCOVERY.defaultAgeRange.max, locationScope: "ANYWHERE", intent: null });
    expect(DISCOVERY.defaultAgeRange).toEqual({ min: 18, max: 60 });
  });

  it("on Friendship leaves the hidden Dating Looking for as it was", () => {
    expect(resetFilterValues("FRIENDSHIP", "MARRIAGE").intent).toBe("MARRIAGE");
  });
});

describe("Filters sheet: own-age warning", () => {
  it("warns (without blocking) only when the range leaves out the member's own age", () => {
    expect(ageRangeWarning(36, 35, 40)).toBeNull();
    expect(ageRangeWarning(31, 35, 40)).toMatch(/You're 31, which is outside this range/);
    expect(ageRangeWarning(null, 35, 40)).toBeNull();
    expect(ageRangeWarning(41, 35, 40)).not.toBeNull();
  });
});

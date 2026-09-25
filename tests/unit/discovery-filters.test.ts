import { describe, expect, it } from "vitest";
import { DISCOVERY } from "@/config/product";
import { ageRangeTooNarrow, ageRangeWarning, moveAgeFrom, moveAgeTo, needsOwnAgeConfirmation, ownAgeOutsideRange, rememberedFriendship, resetFilterValues, showMeForMode } from "@/lib/discovery-filters";

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
  it("notes (without blocking) only when the range leaves out the member's own age, and no longer claims ranges work both ways", () => {
    expect(ageRangeWarning(36, 35, 40)).toBeNull();
    expect(ageRangeWarning(31, 35, 40)).toBe("You're 31, so your own age isn't in this range.");
    expect(ageRangeWarning(null, 35, 40)).toBeNull();
    expect(ageRangeWarning(41, 35, 40)).not.toBeNull();
    expect(ageRangeWarning(31, 35, 40)).not.toMatch(/both ways|may not see you/);
  });
});

/*
 * The two sliders, driven the way the sheet drives them: every drag goes through moveAgeFrom / moveAgeTo with the
 * other slider's current value. `drag` replays a gesture as the sequence of values a range input emits.
 */
describe("Filters sheet: age sliders never collapse", () => {
  const SPAN = DISCOVERY.filterAgeMinSpan;
  const drag = (range: { ageMin: number; ageMax: number }, which: "from" | "to", to: number) => {
    const r = { ...range };
    const start = which === "from" ? r.ageMin : r.ageMax;
    const step = to >= start ? 1 : -1;
    for (let v = start; v !== to + step; v += step) {
      if (which === "from") r.ageMin = moveAgeFrom(v, r.ageMax);
      else r.ageMax = moveAgeTo(v, r.ageMin);
    }
    return r;
  };

  it("uses a 3-year minimum span", () => {
    expect(SPAN).toBe(3);
  });

  it("cannot make 60–60: dragging From all the way right from the default stops at 57", () => {
    expect(drag({ ageMin: 18, ageMax: 60 }, "from", 60)).toEqual({ ageMin: 57, ageMax: 60 });
    expect(moveAgeFrom(60, 60)).toBe(57);
  });

  it("upper boundary: with To at 60, From can't exceed 57; and To can't be dragged below From + 3", () => {
    expect(moveAgeFrom(58, 60)).toBe(57);
    expect(moveAgeFrom(57, 60)).toBe(57);
    expect(drag({ ageMin: 50, ageMax: 60 }, "to", 18)).toEqual({ ageMin: 50, ageMax: 53 });
  });

  it("lower boundary: with From at 18, To can't go below 21; and From can't be dragged above To − 3", () => {
    expect(moveAgeTo(18, 18)).toBe(21);
    expect(moveAgeTo(20, 18)).toBe(21);
    expect(drag({ ageMin: 18, ageMax: 60 }, "to", 18)).toEqual({ ageMin: 18, ageMax: 21 });
    expect(drag({ ageMin: 18, ageMax: 30 }, "from", 60)).toEqual({ ageMin: 27, ageMax: 30 });
  });

  it("clamps safely at the 18–60 bounds", () => {
    expect(moveAgeFrom(10, 60)).toBe(18);
    expect(moveAgeTo(99, 18)).toBe(60);
    // A legacy too-narrow range near a bound never produces a value outside 18–60.
    expect(moveAgeFrom(40, 19)).toBe(18);
    expect(moveAgeTo(40, 59)).toBe(60);
  });

  it("normal ranges are reachable exactly: 18–30 and 25–40", () => {
    expect(drag({ ageMin: 18, ageMax: 60 }, "to", 30)).toEqual({ ageMin: 18, ageMax: 30 });
    const r = drag(drag({ ageMin: 18, ageMax: 60 }, "to", 40), "from", 25);
    expect(r).toEqual({ ageMin: 25, ageMax: 40 });
    expect(ageRangeTooNarrow(18, 30)).toBe(false);
    expect(ageRangeTooNarrow(25, 40)).toBe(false);
  });

  it("no gesture on either slider, from any starting range the sliders can reach, ends narrower than the span", () => {
    for (let min = 18; min <= 57; min++) {
      for (let max = min + SPAN; max <= 60; max++) {
        for (const target of [18, 30, 45, 60]) {
          for (const which of ["from", "to"] as const) {
            const r = drag({ ageMin: min, ageMax: max }, which, target);
            expect(r.ageMax - r.ageMin).toBeGreaterThanOrEqual(SPAN);
            expect(r.ageMin).toBeGreaterThanOrEqual(18);
            expect(r.ageMax).toBeLessThanOrEqual(60);
          }
        }
      }
    }
  });

  it("a stored collapsed range (60–60, 34–34) is recognised as too narrow, and one drag of From repairs it", () => {
    expect(ageRangeTooNarrow(60, 60)).toBe(true);
    expect(ageRangeTooNarrow(34, 34)).toBe(true);
    expect(ageRangeTooNarrow(57, 60)).toBe(false);
    expect(moveAgeFrom(59, 60)).toBe(57);
  });
});

describe("Filters sheet: 'Save it anyway?' for a range without the member's own age", () => {
  const saved = { ageMin: 18, ageMax: 60 };

  it("asks when the member changes the range to one that leaves out their own age", () => {
    expect(needsOwnAgeConfirmation(25, saved, { ageMin: 40, ageMax: 60 })).toBe(true);
    expect(needsOwnAgeConfirmation(45, saved, { ageMin: 18, ageMax: 30 })).toBe(true);
  });

  it("does not ask when the new range includes their age", () => {
    expect(needsOwnAgeConfirmation(25, saved, { ageMin: 18, ageMax: 30 })).toBe(false);
    expect(needsOwnAgeConfirmation(30, saved, { ageMin: 25, ageMax: 40 })).toBe(false);
    // Boundaries are inclusive.
    expect(needsOwnAgeConfirmation(40, saved, { ageMin: 25, ageMax: 40 })).toBe(false);
  });

  it("does not ask again about a range the member is not changing in this edit", () => {
    expect(needsOwnAgeConfirmation(25, { ageMin: 40, ageMax: 60 }, { ageMin: 40, ageMax: 60 })).toBe(false);
  });

  it("never asks without a known own age", () => {
    expect(needsOwnAgeConfirmation(null, saved, { ageMin: 40, ageMax: 60 })).toBe(false);
    expect(ownAgeOutsideRange(null, 40, 60)).toBe(false);
  });
});

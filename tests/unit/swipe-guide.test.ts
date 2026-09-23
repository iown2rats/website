/**
 * The first-visit swipe lesson's two load-bearing claims (docs/DESIGN_SYSTEM.md §43).
 *
 * Both are about the same worry: a tutorial that moves a real card must never be mistaken for a real swipe. The
 * first claim is arithmetic — the demo's furthest lean stays under the distance that commits one. The second is
 * the stamp formula, which the demo and every real drag share so the lesson shows exactly what a finger would.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GUIDE_PEEK, hasSeenSwipeGuide, stampOpacity } from "@/components/features/discovery/swipe-guide";
import { SWIPE_X } from "@/components/features/discovery/swipe-deck";

describe("the lesson cannot look like a committed swipe", () => {
  it("leans less far than the distance that commits one", () => {
    expect(GUIDE_PEEK).toBeLessThan(SWIPE_X);
    // And with enough margin that it reads as a lean rather than a near-miss.
    expect(SWIPE_X - GUIDE_PEEK).toBeGreaterThanOrEqual(20);
  });
});

describe("stamp opacity", () => {
  it("is invisible at rest and on the wrong side", () => {
    expect(stampOpacity(0, "like")).toBe(0);
    expect(stampOpacity(0, "pass")).toBe(0);
    expect(stampOpacity(60, "pass")).toBe(0);
    expect(stampOpacity(-60, "like")).toBe(0);
  });

  it("never shows both at once, at any distance", () => {
    for (let dx = -400; dx <= 400; dx += 7) {
      const both = stampOpacity(dx, "like") > 0 && stampOpacity(dx, "pass") > 0;
      expect(both).toBe(false);
    }
  });

  it("rises with distance rather than flipping at a threshold", () => {
    const steps = [10, 20, 30, 45, 60, 80].map((dx) => stampOpacity(dx, "like"));
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
    // Half the range is half the intensity: linear in distance, which is what makes it feel attached to the finger.
    expect(stampOpacity(45, "like")).toBeCloseTo(0.5, 5);
    expect(stampOpacity(-45, "pass")).toBeCloseTo(0.5, 5);
  });

  it("clamps at 1 however far the card is thrown", () => {
    expect(stampOpacity(90, "like")).toBe(1);
    expect(stampOpacity(600, "like")).toBe(1);
    expect(stampOpacity(-600, "pass")).toBe(1);
  });

  it("is already prominent at the lesson's furthest lean, without maxing out", () => {
    const shown = stampOpacity(GUIDE_PEEK, "like");
    expect(shown).toBeGreaterThan(0.85);
    expect(shown).toBeLessThan(1);
  });
});

describe("the once-only flag", () => {
  const original = Reflect.getOwnPropertyDescriptor(globalThis, "localStorage");
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });

  function stubStorage(impl: Partial<Storage>) {
    Object.defineProperty(globalThis, "localStorage", { value: impl, configurable: true, writable: true });
  }

  it("is false the first time and true once written", () => {
    const store = new Map<string, string>();
    stubStorage({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
    expect(hasSeenSwipeGuide()).toBe(false);
    store.set("thundi.swipeGuideSeen", "1");
    expect(hasSeenSwipeGuide()).toBe(true);
  });

  it("reports seen when storage throws, so a viewer who cannot remember is not taught forever", () => {
    stubStorage({ getItem: () => { throw new Error("blocked"); } });
    expect(hasSeenSwipeGuide()).toBe(true);
  });
});

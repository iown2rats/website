import { describe, expect, it } from "vitest";
import { computeCompletion, type CompletionInput } from "@/server/profiles/completion";

const base: CompletionInput = {
  hasName: true,
  hasDob: true,
  hasGender: true,
  hasInterestedIn: true,
  hasIntent: true,
  hasLocation: true,
  activePhotoCount: 2,
  hasBio: false,
  interestCount: 0,
  promptCount: 0,
  verified: false,
};

describe("profile completion", () => {
  it("requires the core fields and two photos to finish onboarding", () => {
    const r = computeCompletion(base);
    expect(r.requiredComplete).toBe(true);
    expect(r.missingRequired).toEqual([]);
    expect(r.percent).toBe(48); // 5 × 8 core + 8 photos
  });

  it("reports what is missing", () => {
    const r = computeCompletion({ ...base, hasLocation: false, activePhotoCount: 1 });
    expect(r.requiredComplete).toBe(false);
    expect(r.missingRequired).toEqual(["location", "photos"]);
  });

  it("optional fields add up to exactly 100", () => {
    const r = computeCompletion({ ...base, activePhotoCount: 5, hasBio: true, interestCount: 3, promptCount: 1, verified: true });
    expect(r.percent).toBe(100);
    expect(r.suggestions).toEqual([]);
  });

  it("suggestions match the prototype's items and never exceed the remaining points", () => {
    const r = computeCompletion(base);
    expect(r.suggestions.map((s) => s.key)).toEqual(["prompt", "verify", "interests", "bio", "photo"]);
    const total = r.percent + r.suggestions.reduce((n, s) => n + s.points, 0);
    expect(total).toBeLessThanOrEqual(100);
  });

  it("never hardcodes 100 for a fresh profile", () => {
    expect(computeCompletion({ ...base, hasName: false, hasDob: false, hasGender: false, hasInterestedIn: false, hasIntent: false, hasLocation: false, activePhotoCount: 0 }).percent).toBe(0);
  });
});

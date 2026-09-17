import { describe, expect, it } from "vitest";
import { shortRelativeTime } from "@/lib/time";

const NOW = new Date("2026-09-17T20:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("shortRelativeTime (Community card timestamps)", () => {
  it("uses the prototype's compact units", () => {
    expect(shortRelativeTime(ago(0), NOW)).toBe("now");
    expect(shortRelativeTime(ago(59_000), NOW)).toBe("now");
    expect(shortRelativeTime(ago(5 * 60_000), NOW)).toBe("5m");
    expect(shortRelativeTime(ago(2 * 3_600_000), NOW)).toBe("2h");
    expect(shortRelativeTime(ago(23 * 3_600_000 + 59 * 60_000), NOW)).toBe("23h");
    expect(shortRelativeTime(ago(3 * 86_400_000), NOW)).toBe("3d");
  });
  it("falls back to a short date after a week and never goes negative for client clock skew", () => {
    expect(shortRelativeTime(ago(8 * 86_400_000), NOW)).toBe("9 Sept");
    expect(shortRelativeTime(new Date(NOW.getTime() + 30_000).toISOString(), NOW)).toBe("now");
  });
});

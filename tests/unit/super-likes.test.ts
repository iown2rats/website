import { describe, expect, it } from "vitest";
import { PRODUCT_RULES, SUPER_LIKE, USAGE_WINDOWS } from "@/config/product";
import { formatResetIn, SUPER_LIKE_MESSAGE_MAX, superLikeAllowanceText, superLikeMessageLength } from "@/lib/super-likes";
import { normalizeSuperLikeMessage } from "@/server/likes/like";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("Super Like rules (docs/ARCHITECTURE.md §12.20)", () => {
  it("is Plus only: 5 every 7 days, none for Free, 150-character messages", () => {
    expect(PRODUCT_RULES.FREE.superLikesPerWindow).toBe(0);
    expect(PRODUCT_RULES.PLUS.superLikesPerWindow).toBe(5);
    expect(USAGE_WINDOWS.SUPER_LIKES).toBe(7 * DAY);
    expect(SUPER_LIKE.messageMaxLength).toBe(150);
    expect(SUPER_LIKE_MESSAGE_MAX).toBe(150);
  });
});

describe("formatResetIn", () => {
  it("rounds up, so a reset is never promised early", () => {
    expect(formatResetIn(30 * 60_000)).toBe("less than an hour");
    expect(formatResetIn(HOUR)).toBe("1 hour");
    expect(formatResetIn(HOUR + 1)).toBe("2 hours");
    expect(formatResetIn(23 * HOUR)).toBe("23 hours");
    expect(formatResetIn(DAY)).toBe("1 day");
    expect(formatResetIn(3 * DAY + 1)).toBe("4 days");
    expect(formatResetIn(7 * DAY)).toBe("7 days");
  });
});

describe("superLikeAllowanceText", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  it("says how many are left and, while a window is open, when it resets", () => {
    expect(superLikeAllowanceText({ limit: 5, remaining: 3, resetsAt: new Date(now + 3.5 * DAY).toISOString() }, now)).toEqual({ left: "3 of 5 Super Likes left", reset: "Resets in 4 days" });
    expect(superLikeAllowanceText({ limit: 5, remaining: 0, resetsAt: new Date(now + 2 * DAY).toISOString() }, now)).toEqual({ left: "0 of 5 Super Likes left", reset: "Resets in 2 days" });
  });
  it("no window yet, or one already over, means no reset line", () => {
    expect(superLikeAllowanceText({ limit: 5, remaining: 5, resetsAt: null }, now)).toEqual({ left: "5 of 5 Super Likes left", reset: null });
    expect(superLikeAllowanceText({ limit: 5, remaining: 0, resetsAt: new Date(now - 1).toISOString() }, now).reset).toBeNull();
  });
});

describe("the message, counted and cleaned the same on both sides", () => {
  it("counts code points of the trimmed text, as the server does", () => {
    expect(superLikeMessageLength("  hi  ")).toBe(2);
    expect(superLikeMessageLength("😄😄")).toBe(2);
    expect(superLikeMessageLength("   ")).toBe(0);
  });

  it("server: empty and whitespace-only become no message; 150 fits; 151 does not", () => {
    expect(normalizeSuperLikeMessage(undefined)).toBeNull();
    expect(normalizeSuperLikeMessage(null)).toBeNull();
    expect(normalizeSuperLikeMessage("")).toBeNull();
    expect(normalizeSuperLikeMessage(" \n\t ")).toBeNull();
    expect(normalizeSuperLikeMessage(`  ${"a".repeat(150)}  `)).toBe("a".repeat(150));
    expect(normalizeSuperLikeMessage("😄".repeat(150))).toBe("😄".repeat(150));
    expect(() => normalizeSuperLikeMessage("a".repeat(151))).toThrow("up to 150 characters");
    expect(() => normalizeSuperLikeMessage("😄".repeat(151))).toThrow();
  });

  it("the client counter and the server agree on every sample", () => {
    for (const s of ["", "  x  ", "😄".repeat(150), `${"a".repeat(149)}😄`, "a".repeat(151), "\r\nhi\r\n"]) {
      const clientOk = superLikeMessageLength(s) <= SUPER_LIKE_MESSAGE_MAX;
      let serverOk = true;
      try {
        normalizeSuperLikeMessage(s);
      } catch {
        serverOk = false;
      }
      expect(clientOk).toBe(serverOk);
    }
  });
});

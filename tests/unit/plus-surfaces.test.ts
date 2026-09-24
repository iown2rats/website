import { describe, expect, it } from "vitest";
import { membershipHref, parsePlusSurface, PLUS_SURFACES } from "@/lib/plus-surfaces";

describe("Plus promotion surfaces", () => {
  it("accepts exactly the closed list", () => {
    for (const s of PLUS_SURFACES) expect(parsePlusSurface(s)).toBe(s);
  });

  it("refuses anything else rather than repairing it", () => {
    for (const bad of ["", "LIKES_YOU", " likes_you", "likes_you ", "likes_you;drop", "<script>", "boost", null, undefined, 42, {}, ["likes_you"]]) {
      expect(parsePlusSurface(bad)).toBeNull();
    }
  });

  it("builds Membership links that carry only a known surface", () => {
    expect(membershipHref()).toBe("/settings/membership");
    expect(membershipHref("daily_limit")).toBe("/settings/membership?from=daily_limit");
  });
});

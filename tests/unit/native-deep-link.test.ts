import { describe, expect, it } from "vitest";
import { resolveDeepLink } from "@/components/features/auth/native-bridge";

/*
 * The deep link is the one value in the Android flow that arrives from outside the app — Android hands it over
 * from Chrome, and any app on the device could in principle send one. So it is parsed strictly and never trusted
 * to name its own destination: this function only ever returns a fixed same-origin path, so a crafted link cannot
 * steer the WebView anywhere of its choosing.
 */
const VERIFIER = "v".repeat(43);

describe("resolveDeepLink", () => {
  it("turns a successful callback into the redemption URL", () => {
    expect(resolveDeepLink("com.mellocrush.app://auth/callback?code=abc123", VERIFIER)).toBe(`/auth/handoff?code=abc123&verifier=${VERIFIER}`);
  });

  it("refuses anything that is not our scheme and host", () => {
    for (const url of [
      "https://evil.example/auth/callback?code=abc",
      "com.evil.app://auth/callback?code=abc",
      "com.mellocrush.app://elsewhere?code=abc",
      "com.mellocrush.app.evil://auth/callback?code=abc",
      "not a url",
      "",
    ]) {
      expect(resolveDeepLink(url, VERIFIER), url).toBeNull();
    }
  });

  it("never lets the link choose the destination", () => {
    // Whatever else is in the query, the result is one of two fixed paths on our own origin.
    const crafted = resolveDeepLink("com.mellocrush.app://auth/callback?code=abc&next=https://evil.example&landing=/admin", VERIFIER);
    expect(crafted).toBe(`/auth/handoff?code=abc&verifier=${VERIFIER}`);
    expect(crafted).not.toContain("evil.example");
  });

  it("escapes what it puts in the query", () => {
    expect(resolveDeepLink("com.mellocrush.app://auth/callback?code=a%26b%3Dc", VERIFIER)).toBe(`/auth/handoff?code=a%26b%3Dc&verifier=${VERIFIER}`);
  });

  it("passes a provider error through to the ordinary error screen", () => {
    expect(resolveDeepLink("com.mellocrush.app://auth/callback?error=cancelled&provider=google", VERIFIER)).toBe("/auth/error?reason=cancelled&provider=google");
    expect(resolveDeepLink("com.mellocrush.app://auth/callback?error=deleted&provider=telegram", null)).toBe("/auth/error?reason=deleted&provider=telegram");
    // An error wins over a code, so a link carrying both cannot smuggle a redemption past the error path.
    expect(resolveDeepLink("com.mellocrush.app://auth/callback?error=state&code=abc", VERIFIER)).toBe("/auth/error?reason=state");
  });

  it("fails closed when the verifier is gone", () => {
    // The app was restarted, or storage was cleared, while the user was away in the browser. Redeeming without a
    // verifier is impossible by design, so say so rather than sending a request that must fail.
    expect(resolveDeepLink("com.mellocrush.app://auth/callback?code=abc", null)).toBe("/auth/error?reason=handoff");
    expect(resolveDeepLink("com.mellocrush.app://auth/callback", VERIFIER)).toBe("/auth/error?reason=handoff");
  });
});

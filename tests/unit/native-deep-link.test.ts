import { describe, expect, it } from "vitest";
import { resolveDeepLink, takeStoredVerifier } from "@/components/features/auth/native-bridge";

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

/*
 * Verifier storage. The question these answer cannot be asked of a browser: "does this survive Android reclaiming
 * the app's process while the user is in the Custom Tab?" It survives because the value is in localStorage rather
 * than sessionStorage — sessionStorage belongs to the WebView, and a reclaimed app gets a new one.
 */
const KEY = "mellocrush.handoff.verifier";
const T0 = 1_700_000_000_000;
const TTL = 15 * 60_000;

function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("takeStoredVerifier", () => {
  it("returns the verifier and clears it, so a second read finds nothing", () => {
    const store = fakeStore({ [KEY]: JSON.stringify({ verifier: VERIFIER, issuedAt: T0 }) });
    expect(takeStoredVerifier(store, T0 + 30_000)).toBe(VERIFIER);
    expect(store.map.has(KEY)).toBe(false);
    expect(takeStoredVerifier(store, T0 + 30_000)).toBeNull();
  });

  it("accepts a verifier stored just inside the window and rejects one just outside", () => {
    const fresh = fakeStore({ [KEY]: JSON.stringify({ verifier: VERIFIER, issuedAt: T0 }) });
    expect(takeStoredVerifier(fresh, T0 + TTL)).toBe(VERIFIER);
    const stale = fakeStore({ [KEY]: JSON.stringify({ verifier: VERIFIER, issuedAt: T0 }) });
    expect(takeStoredVerifier(stale, T0 + TTL + 1)).toBeNull();
    // …and the stale one is cleared rather than left to be retried.
    expect(stale.map.has(KEY)).toBe(false);
  });

  it("rejects a timestamp from the future, in case the device clock moved", () => {
    const store = fakeStore({ [KEY]: JSON.stringify({ verifier: VERIFIER, issuedAt: T0 + 60_000 }) });
    expect(takeStoredVerifier(store, T0)).toBeNull();
  });

  it("survives anything unexpected in the slot", () => {
    for (const value of ["", "not json", "null", "[]", '{"verifier":123,"issuedAt":1}', `{"verifier":"${VERIFIER}"}`, '{"issuedAt":1}']) {
      expect(takeStoredVerifier(fakeStore({ [KEY]: value }), T0), value).toBeNull();
    }
    expect(takeStoredVerifier(fakeStore(), T0)).toBeNull();
  });

  it("returns null rather than throwing when storage itself is unavailable", () => {
    const blocked = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      removeItem: () => undefined,
    };
    expect(takeStoredVerifier(blocked, T0)).toBeNull();
  });
});

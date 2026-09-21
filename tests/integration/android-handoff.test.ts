import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { isNativeAndroidUserAgent, NATIVE_APP_ID, NATIVE_UA_SUFFIX } from "@/lib/native-app";
import { consumeHandoff, createVerifierChallenge, HANDOFF_TTL_MS, issueHandoff, parseHandoffSecret, purgeExpiredHandoffs } from "@/server/auth/handoff";
import { ROUTES, resolveAccess } from "@/server/auth/route-access";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser } from "../helpers/factory";

/*
 * The Android sign-in handoff (docs/ARCHITECTURE.md §4.1c).
 *
 * The threat this exists to survive is specific: a custom scheme on Android can be registered by any installed
 * app, so the deep link carrying the code may well be delivered to something hostile. These tests are mostly
 * about what such an app can and cannot do with a code it has stolen.
 */
const db = testDb();
const T0 = new Date("2026-09-21T14:00:00Z");
const VERIFIER = "a".repeat(43);
const CHALLENGE = createVerifierChallenge(VERIFIER);

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

const issue = async (userId: string, now = T0, landing: string = ROUTES.home) =>
  (await issueHandoff(db, { userId, landing, provider: "google", challenge: CHALLENGE }, now)).code;

describe("handoff secrets", () => {
  it("accepts only the shape it issues", () => {
    expect(parseHandoffSecret(VERIFIER)).toBe(VERIFIER);
    expect(parseHandoffSecret("")).toBeNull();
    expect(parseHandoffSecret(null)).toBeNull();
    expect(parseHandoffSecret("a".repeat(42))).toBeNull();
    expect(parseHandoffSecret("a".repeat(44))).toBeNull();
    // Base64url only: no padding, no slashes, nothing that would need escaping in a URL.
    expect(parseHandoffSecret(`${"a".repeat(42)}=`)).toBeNull();
    expect(parseHandoffSecret(`${"a".repeat(42)}/`)).toBeNull();
    expect(parseHandoffSecret(`${"a".repeat(42)}+`)).toBeNull();
  });

  it("issues a fresh unguessable code every time, and never stores it", async () => {
    const me = await createUser(db, { now: T0 });
    const first = await issue(me.userId);
    const second = await issue(me.userId);
    expect(first).not.toBe(second);
    expect(first).toHaveLength(43);

    // Nothing in the table equals either raw value: both columns are digests.
    const rows = await db.authHandoff.findMany({ select: { codeHash: true, challengeHash: true } });
    const stored = JSON.stringify(rows.map((r) => [Buffer.from(r.codeHash).toString("base64url"), Buffer.from(r.challengeHash).toString("base64url")]));
    expect(stored).not.toContain(first);
    expect(stored).not.toContain(second);
    expect(stored).not.toContain(VERIFIER);
  });
});

describe("redeeming a handoff", () => {
  it("returns the user and landing exactly once", async () => {
    const me = await createUser(db, { now: T0 });
    const code = await issue(me.userId, T0, ROUTES.onboarding);

    expect(await consumeHandoff(db, code, VERIFIER, at(T0, 1000))).toEqual({ userId: me.userId, landing: ROUTES.onboarding });
    // Replay: the second attempt is indistinguishable from a code that never existed.
    expect(await consumeHandoff(db, code, VERIFIER, at(T0, 2000))).toBeNull();
  });

  it("refuses a code held without the verifier — the whole point of the second secret", async () => {
    const me = await createUser(db, { now: T0 });
    const code = await issue(me.userId);

    // An app that intercepted the deep link has exactly this: the code, and no idea what hashed to the challenge.
    expect(await consumeHandoff(db, code, "b".repeat(43), at(T0, 1000))).toBeNull();
    expect(await consumeHandoff(db, code, "", at(T0, 1000))).toBeNull();
    // …and having failed, the real app can still redeem it: a wrong guess must not burn the code.
    expect(await consumeHandoff(db, code, VERIFIER, at(T0, 1500))).toMatchObject({ userId: me.userId });
  });

  it("expires", async () => {
    const me = await createUser(db, { now: T0 });
    const code = await issue(me.userId);
    expect(await consumeHandoff(db, code, VERIFIER, at(T0, HANDOFF_TTL_MS + 1))).toBeNull();
    // Still unconsumed, but permanently useless.
    const row = await db.authHandoff.findFirstOrThrow({ select: { consumedAt: true } });
    expect(row.consumedAt).toBeNull();
  });

  it("refuses codes that were never issued, and malformed input", async () => {
    await createUser(db, { now: T0 });
    expect(await consumeHandoff(db, "c".repeat(43), VERIFIER, T0)).toBeNull();
    expect(await consumeHandoff(db, "", VERIFIER, T0)).toBeNull();
    expect(await consumeHandoff(db, "not-a-code", VERIFIER, T0)).toBeNull();
  });

  it("cannot be won twice by two racing redemptions", async () => {
    const me = await createUser(db, { now: T0 });
    const code = await issue(me.userId);
    const results = await Promise.all(Array.from({ length: 6 }, () => consumeHandoff(db, code, VERIFIER, at(T0, 1000))));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("dies with the account it belongs to", async () => {
    const me = await createUser(db, { now: T0 });
    const code = await issue(me.userId);
    await db.user.delete({ where: { id: me.userId } });
    expect(await db.authHandoff.count()).toBe(0);
    expect(await consumeHandoff(db, code, VERIFIER, at(T0, 1000))).toBeNull();
  });

  it("purges expired rows without touching live ones", async () => {
    const me = await createUser(db, { now: T0 });
    await issue(me.userId, T0);
    const fresh = await issue(me.userId, at(T0, HANDOFF_TTL_MS));
    expect(await purgeExpiredHandoffs(db, at(T0, HANDOFF_TTL_MS + 1))).toBe(1);
    expect(await consumeHandoff(db, fresh, VERIFIER, at(T0, HANDOFF_TTL_MS + 1))).toMatchObject({ userId: me.userId });
  });
});

describe("the native contract", () => {
  it("detects the shell by its user-agent suffix and nothing else", () => {
    expect(isNativeAndroidUserAgent(`Mozilla/5.0 (Linux; Android 14) ${NATIVE_UA_SUFFIX}`)).toBe(true);
    expect(isNativeAndroidUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/120")).toBe(false);
    expect(isNativeAndroidUserAgent("")).toBe(false);
    expect(isNativeAndroidUserAgent(null)).toBe(false);
    expect(isNativeAndroidUserAgent(undefined)).toBe(false);
  });

  it("uses the application id as the deep-link scheme, matching the Android manifest", () => {
    expect(NATIVE_APP_ID).toBe("com.mellocrush.app");
  });

  it("lets the redemption endpoint be reached in every session state", () => {
    // The WebView may arrive carrying a stale cookie, a half-finished onboarding or nothing at all; the route
    // itself decides. If any of these redirected, sign-in would loop.
    for (const kind of ["anonymous", "onboarding", "active", "unverified", "staff"] as const) {
      expect(resolveAccess(kind, ROUTES.handoff), kind).toEqual({ allow: true });
    }
  });
});

/**
 * Telegram sign-in via OpenID Connect (docs/ARCHITECTURE.md §4.1). Covers the provider (authorization request,
 * token exchange with HTTP Basic client authentication and PKCE, RS256 verification against Telegram's JWKS,
 * claims without an email), the environment switch, the identity mapping beside Google (no cross-provider merge),
 * re-authentication binding, deletion and the fresh-account path, and the development stand-in's Telegram shape.
 */
import { createSign, generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache, telegramLoginEnabled } from "@/lib/env";
import { InvalidStateError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { createFreshAccountForIdentity, describeSignInIdentity, getSignInIdentity, recordReauthentication, signInWithIdentity } from "@/server/auth/identity";
import { decodeJwt, toB64url, type VerifiedClaims } from "@/server/auth/jwt";
import { createPkcePair, DEV_OIDC, DevOidcProvider, getOidcProvider, OidcExchangeError, pkceChallenge, redirectUri, resetOidcProviderCache, TELEGRAM, TelegramOidcProvider } from "@/server/auth/oidc";
import { createSession } from "@/server/auth/session";
import { databaseSupportsTelegram, resetTelegramAvailabilityCache } from "@/server/auth/telegram-availability";
import { deleteAccount } from "@/server/users/deletion";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createIdentity, createUser, minutes } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-18T16:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const CLIENT_ID = "8381320924";

const tg = (subject: string, o: { name?: string | null; username?: string | null } = {}): VerifiedClaims => ({ subject, email: null, emailVerified: false, name: o.name ?? "Aishath", username: o.username ?? null, authTime: null, issuedAt: T0 });

/** A fake Telegram: RSA key pair, JWKS document and an RS256 signer. */
function fakeTelegram() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const jwks = { keys: [{ ...jwk, kid: "tg1", alg: "RS256", use: "sig" }] };
  const sign = (payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "tg1", typ: "JWT" }) => {
    const h = toB64url(JSON.stringify(header));
    const p = toB64url(JSON.stringify(payload));
    const signer = createSign("RSA-SHA256");
    signer.update(`${h}.${p}`);
    return `${h}.${p}.${signer.sign(privateKey).toString("base64url")}`;
  };
  return { jwks, sign };
}

const validPayload = (nonce: string, overrides: Record<string, unknown> = {}) => ({
  iss: TELEGRAM.issuer,
  aud: CLIENT_ID,
  sub: "123456789",
  name: "Aishath Ibrahim",
  given_name: "Aishath",
  family_name: "Ibrahim",
  preferred_username: "aishath_i",
  picture: "https://t.me/i/userpic/320/x.jpg",
  nonce,
  iat: Math.floor(T0.getTime() / 1000) - 5,
  exp: Math.floor(T0.getTime() / 1000) + 3600,
  ...overrides,
});

beforeEach(() => resetDb(db));
afterEach(() => {
  resetEnvCache();
  resetOidcProviderCache();
});
afterAll(() => disconnectDb());

describe("ID token verification (Telegram)", () => {
  it("accepts a valid RS256 token from Telegram's JWKS; no email is required and the username is normalised", async () => {
    const t = fakeTelegram();
    const provider = new TelegramOidcProvider({ clientId: CLIENT_ID, clientSecret: "s", jwksLoader: async () => t.jwks });
    const claims = await provider.verifyIdToken(t.sign(validPayload("n1", { preferred_username: "@Aishath_I " })), { nonce: "n1", now: T0 });
    expect(claims).toEqual({ subject: "123456789", email: null, emailVerified: false, name: "Aishath Ibrahim", username: "Aishath_I", authTime: null, issuedAt: new Date((Math.floor(T0.getTime() / 1000) - 5) * 1000) });
    // Name falls back to given + family when `name` is absent; a missing or malformed username is null, never an identifier.
    const noName = await provider.verifyIdToken(t.sign(validPayload("n2", { name: undefined, preferred_username: "has spaces" })), { nonce: "n2", now: T0 });
    expect(noName).toMatchObject({ name: "Aishath Ibrahim", username: null });
    const bare = await provider.verifyIdToken(t.sign(validPayload("n3", { name: undefined, given_name: undefined, family_name: undefined, preferred_username: undefined })), { nonce: "n3", now: T0 });
    expect(bare).toMatchObject({ subject: "123456789", name: null, username: null, email: null });
  });

  it("rejects wrong issuer (including Google's), audience, expiry, nonce, unknown key, tampered payload and non-RS256 algorithms", async () => {
    const t = fakeTelegram();
    const provider = new TelegramOidcProvider({ clientId: CLIENT_ID, clientSecret: "s", jwksLoader: async () => t.jwks });
    const cases: [string, string][] = [
      ["issuer", t.sign(validPayload("n", { iss: "https://accounts.google.com" }))],
      ["issuer", t.sign(validPayload("n", { iss: "https://oauth.telegram.org.evil.example" }))],
      ["audience", t.sign(validPayload("n", { aud: "other-bot" }))],
      ["expired", t.sign(validPayload("n", { exp: Math.floor(T0.getTime() / 1000) - 120 }))],
      ["nonce", t.sign(validPayload("other"))],
      ["subject", t.sign(validPayload("n", { sub: "" }))],
      ["signature", t.sign(validPayload("n"), { alg: "RS256", kid: "unknown-kid", typ: "JWT" })],
      ["algorithm", t.sign(validPayload("n"), { alg: "ES256", kid: "tg1", typ: "JWT" })],
      ["algorithm", t.sign(validPayload("n"), { alg: "none", kid: "tg1", typ: "JWT" })],
    ];
    for (const [reason, token] of cases) {
      await expect(provider.verifyIdToken(token, { nonce: "n", now: T0 }), reason).rejects.toThrow(new RegExp(reason));
    }
    const good = t.sign(validPayload("n"));
    const [h, , s] = good.split(".");
    const tampered = `${h}.${toB64url(JSON.stringify(validPayload("n", { sub: "999" })))}.${s}`;
    await expect(provider.verifyIdToken(tampered, { nonce: "n", now: T0 })).rejects.toThrow(/signature/);
  });

  it("refreshes the JWKS once when the key id is unknown (key rotation) and caches it otherwise", async () => {
    const t = fakeTelegram();
    let loads = 0;
    const provider = new TelegramOidcProvider({ clientId: CLIENT_ID, clientSecret: "s", jwksLoader: async () => { loads += 1; return t.jwks; } });
    await provider.verifyIdToken(t.sign(validPayload("a")), { nonce: "a", now: T0 });
    await provider.verifyIdToken(t.sign(validPayload("b")), { nonce: "b", now: at(T0, 1000) });
    expect(loads).toBe(1);
    await expect(provider.verifyIdToken(t.sign(validPayload("c"), { alg: "RS256", kid: "rotated", typ: "JWT" }), { nonce: "c", now: at(T0, 2000) })).rejects.toThrow(/signature/);
    expect(loads).toBe(2);
  });

  it("builds a PKCE/state/nonce authorization request and exchanges the code with HTTP Basic client authentication; the secret never appears in the body", async () => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body), headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})) });
      return new Response(JSON.stringify({ id_token: "token", access_token: "ignored", token_type: "Bearer" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const provider = new TelegramOidcProvider({ clientId: CLIENT_ID, clientSecret: "secret-1", fetchImpl });
    const { codeVerifier, codeChallenge } = createPkcePair();
    const redirect = "https://www.mellocrush.com/auth/telegram/callback";
    const url = new URL(provider.authorizationUrl({ redirectUri: redirect, state: "st", nonce: "no", codeChallenge, selectAccount: true, loginHint: "ignored@example.com" }));
    expect(url.origin + url.pathname).toBe(TELEGRAM.authorizationEndpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: CLIENT_ID, redirect_uri: redirect, response_type: "code", scope: "openid profile", state: "st", nonce: "no", code_challenge: codeChallenge, code_challenge_method: "S256" });
    expect(url.searchParams.get("scope")).not.toMatch(/phone|email/);
    const { idToken } = await provider.exchangeCode({ code: "abc", codeVerifier, redirectUri: redirect });
    expect(idToken).toBe("token");
    const call = calls[0]!;
    expect(call.url).toBe(TELEGRAM.tokenEndpoint);
    expect(call.headers.authorization).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:secret-1`).toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(call.body))).toEqual({ code: "abc", code_verifier: codeVerifier, redirect_uri: redirect, grant_type: "authorization_code" });
    expect(call.body).not.toContain("secret-1");
    const failing = new TelegramOidcProvider({ clientId: CLIENT_ID, clientSecret: "s", fetchImpl: async () => new Response('{"error":"invalid_client"}', { status: 401 }) });
    await expect(failing.exchangeCode({ code: "x", codeVerifier, redirectUri: redirect })).rejects.toBeInstanceOf(OidcExchangeError);
    const noToken = new TelegramOidcProvider({ clientId: CLIENT_ID, clientSecret: "s", fetchImpl: async () => new Response('{"access_token":"a"}', { status: 200 }) });
    await expect(noToken.exchangeCode({ code: "x", codeVerifier, redirectUri: redirect })).rejects.toThrow(/id_token/);
    expect(pkceChallenge(codeVerifier)).toBe(codeChallenge);
  });
});

describe("environment switch", () => {
  const withEnv = (patch: Record<string, string | undefined>, fn: () => void) => {
    const original = { ...process.env };
    try {
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      resetEnvCache();
      resetOidcProviderCache();
      fn();
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in original)) delete process.env[k];
      Object.assign(process.env, original);
      resetEnvCache();
      resetOidcProviderCache();
    }
  };
  const prod = { NODE_ENV: "production", AUTH_PROVIDER: undefined, STORAGE_PROVIDER: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x", GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs", APP_URL: "https://www.mellocrush.com" };

  it("Telegram is off in production until both variables exist, on with both, and a lone variable is a configuration error", () => {
    withEnv({ ...prod, TELEGRAM_CLIENT_ID: undefined, TELEGRAM_CLIENT_SECRET: undefined }, () => {
      expect(telegramLoginEnabled()).toBe(false);
      expect(getOidcProvider("google").id).toBe("google");
      expect(() => getOidcProvider("telegram")).toThrow(/TELEGRAM_CLIENT_ID/);
    });
    withEnv({ ...prod, TELEGRAM_CLIENT_ID: CLIENT_ID, TELEGRAM_CLIENT_SECRET: undefined }, () => {
      expect(() => getEnv()).toThrow(/TELEGRAM_CLIENT_ID/);
    });
    withEnv({ ...prod, TELEGRAM_CLIENT_ID: CLIENT_ID, TELEGRAM_CLIENT_SECRET: "sec" }, () => {
      expect(telegramLoginEnabled()).toBe(true);
      const p = getOidcProvider("telegram");
      expect(p.id).toBe("telegram");
      expect(p.kind).toBe("telegram");
      expect(getOidcProvider("google").id).toBe("google");
      expect(redirectUri("telegram")).toBe("https://www.mellocrush.com/auth/telegram/callback");
      expect(redirectUri("google")).toBe("https://www.mellocrush.com/auth/google/callback");
      expect(new URL(p.authorizationUrl({ redirectUri: redirectUri("telegram"), state: "s", nonce: "n", codeChallenge: "c" })).searchParams.get("redirect_uri")).toBe("https://www.mellocrush.com/auth/telegram/callback");
    });
  });

  it("with the development identity provider both shapes are the local stand-in", () => {
    withEnv({ AUTH_PROVIDER: "dev", APP_URL: "http://localhost:3100" }, () => {
      expect(telegramLoginEnabled()).toBe(true);
      const t = getOidcProvider("telegram");
      const g = getOidcProvider("google");
      expect(t).toBeInstanceOf(DevOidcProvider);
      expect(t.kind).toBe("telegram");
      expect(g.kind).toBe("google");
      expect(t).not.toBe(g);
      expect(new URL(t.authorizationUrl({ redirectUri: redirectUri("telegram"), state: "s", nonce: "n", codeChallenge: "c" })).searchParams.get("provider")).toBe("telegram");
    });
  });
});

describe("database readiness guard", () => {
  it("offers Telegram only when the TELEGRAM enum value exists; a database without the migration hides it and is re-checked later", async () => {
    resetTelegramAvailabilityCache();
    expect(await databaseSupportsTelegram(db)).toBe(true);
    resetTelegramAvailabilityCache();
    const before = { $queryRaw: async () => [] } as unknown as typeof db;
    expect(await databaseSupportsTelegram(before, 1_000)).toBe(false);
    // Cached negative within the minute, then re-checked against the real database.
    expect(await databaseSupportsTelegram(db, 30_000)).toBe(false);
    expect(await databaseSupportsTelegram(db, 61_001)).toBe(true);
    // A failing query never throws into the page; it just hides the button.
    resetTelegramAvailabilityCache();
    const broken = { $queryRaw: async () => { throw new Error("connection refused"); } } as unknown as typeof db;
    expect(await databaseSupportsTelegram(broken, 1_000)).toBe(false);
    resetTelegramAvailabilityCache();
  });
});

describe("development stand-in, Telegram shape", () => {
  const provider = new DevOidcProvider("http://localhost:3100", "s".repeat(40), "telegram");
  const redirect = "http://localhost:3100/auth/telegram/callback";

  it("mints tokens with no email and a preferred_username under its own issuer; codes from the Google shape do not verify here", async () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    const code = provider.issueCode({ sub: "900000000000001", name: "Hassan", username: "hassan_m" }, { redirectUri: redirect, nonce: "n1", codeChallenge }, T0);
    const { idToken } = await provider.exchangeCode({ code, codeVerifier, redirectUri: redirect }, at(T0, 1000));
    expect(decodeJwt(idToken).payload).toMatchObject({ iss: DEV_OIDC.issuers.telegram, aud: DEV_OIDC.audience, preferred_username: "hassan_m" });
    expect(decodeJwt(idToken).payload).not.toHaveProperty("email");
    const claims = await provider.verifyIdToken(idToken, { nonce: "n1", now: at(T0, 2000) });
    expect(claims).toMatchObject({ subject: "900000000000001", email: null, emailVerified: false, name: "Hassan", username: "hassan_m" });
    await expect(provider.verifyIdToken(idToken, { nonce: "other", now: at(T0, 2000) })).rejects.toThrow(/nonce/);
    const google = new DevOidcProvider("http://localhost:3100", "s".repeat(40), "google");
    await expect(google.verifyIdToken(idToken, { nonce: "n1", now: at(T0, 2000) })).rejects.toThrow(/signature/);
    await expect(google.exchangeCode({ code, codeVerifier, redirectUri: redirect }, at(T0, 1000))).rejects.toThrow(/signature/);
  });
});

describe("identity → User mapping (Telegram beside Google)", () => {
  it("a new Telegram subject creates one ONBOARDING account with a TELEGRAM identity, no email; returning sign-ins map to the same account", async () => {
    const first = await signInWithIdentity(db, "telegram", tg("123456789", { name: "Aishath", username: "aishath_i" }), T0);
    expect(first).toMatchObject({ kind: "signed-in", destination: "onboarding", isNewAccount: true });
    if (first.kind !== "signed-in") throw new Error("expected sign-in");
    const user = await db.user.findUniqueOrThrow({ where: { id: first.userId }, include: { verification: true, privacy: true, identities: true } });
    expect(user).toMatchObject({ status: "ONBOARDING", onboardingStage: "NAME", phoneE164: null });
    expect(user.verification?.status).toBe("NONE");
    expect(user.identities).toHaveLength(1);
    expect(user.identities[0]).toMatchObject({ provider: "TELEGRAM", providerSubject: "123456789", email: null, emailVerified: false, displayName: "Aishath", providerUsername: "aishath_i" });
    // Username and name changes on Telegram refresh the row and land on the same account.
    const again = await signInWithIdentity(db, "telegram", tg("123456789", { name: "Aish", username: "aish" }), at(T0, 1000));
    expect(again).toMatchObject({ kind: "signed-in", userId: first.userId, isNewAccount: false, destination: "onboarding" });
    expect(await db.user.count()).toBe(1);
    const view = await getSignInIdentity(db, first.userId);
    expect(view).toEqual({ provider: "telegram", email: null, name: "Aish", username: "aish" });
    expect(describeSignInIdentity(view)).toBe("@aish");
    expect(describeSignInIdentity({ provider: "telegram", email: null, name: "Aish", username: null })).toBe("Aish");
    expect(describeSignInIdentity({ provider: "google", email: "a@b.c", name: "Aish", username: null })).toBe("a@b.c");
  });

  it("never merges across providers: the same name/username on Google and Telegram, or the same numeric subject, are different people", async () => {
    const g = await signInWithIdentity(db, "google", { subject: "123456789", email: "aishath_i@gmail.com", emailVerified: true, name: "Aishath", username: null, authTime: null, issuedAt: T0 }, T0);
    const t = await signInWithIdentity(db, "telegram", tg("123456789", { name: "Aishath", username: "aishath_i" }), at(T0, 1000));
    if (g.kind !== "signed-in" || t.kind !== "signed-in") throw new Error("expected sign-ins");
    expect(g.userId).not.toBe(t.userId);
    expect(t.isNewAccount).toBe(true);
    expect(await db.user.count()).toBe(2);
    expect(await db.authIdentity.count()).toBe(2);
    // A completed Google account with a matching name gains nothing from a Telegram sign-in with that name.
    const completed = await createUser(db, { now: T0, name: "Hassan" });
    await createIdentity(db, completed.userId, { email: "hassan@example.com", name: "Hassan" });
    const viaTelegram = await signInWithIdentity(db, "telegram", tg("555", { name: "Hassan", username: "hassan" }), at(T0, 2000));
    expect(viaTelegram).toMatchObject({ kind: "signed-in", destination: "onboarding", isNewAccount: true });
    expect(viaTelegram.kind === "signed-in" && viaTelegram.userId !== completed.userId).toBe(true);
  });

  it("concurrent first sign-ins for one Telegram subject converge on a single account", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => signInWithIdentity(db, "telegram", tg("race"), T0)));
    expect(new Set(results.map((r) => (r.kind === "signed-in" ? r.userId : r.kind))).size).toBe(1);
    expect(await db.user.count()).toBe(1);
  });

  it("suspended and banned Telegram accounts get no session; a completed one goes to the app", async () => {
    const active = await createUser(db, { now: T0 });
    await db.authIdentity.create({ data: { userId: active.userId, provider: "TELEGRAM", providerSubject: "777", email: null, providerUsername: "act" } });
    expect(await signInWithIdentity(db, "telegram", tg("777"), T0)).toMatchObject({ kind: "signed-in", userId: active.userId, destination: "app" });
    for (const status of ["SUSPENDED", "BANNED"] as const) {
      const u = await createUser(db, { now: T0 });
      await db.authIdentity.create({ data: { userId: u.userId, provider: "TELEGRAM", providerSubject: `s-${status}`, email: null } });
      await db.user.update({ where: { id: u.userId }, data: { status } });
      expect(await signInWithIdentity(db, "telegram", tg(`s-${status}`), T0)).toEqual({ kind: "unavailable" });
    }
  });

  it("re-authentication is bound to the same provider and subject: a Google token for the same user, or a Telegram token for someone else, never marks the session", async () => {
    const me = await createUser(db, { now: T0 });
    await db.authIdentity.create({ data: { userId: me.userId, provider: "TELEGRAM", providerSubject: "me-tg", email: null, providerUsername: "me" } });
    const other = await createUser(db, { now: T0 });
    await db.authIdentity.create({ data: { userId: other.userId, provider: "TELEGRAM", providerSubject: "other-tg", email: null } });
    const session = await createSession(db, me.userId, {}, T0);
    expect(await recordReauthentication(db, { sessionId: session.sessionId, userId: me.userId, provider: "telegram", claims: tg("other-tg") }, T0)).toBe(false);
    expect(await recordReauthentication(db, { sessionId: session.sessionId, userId: me.userId, provider: "google", claims: { ...tg("me-tg"), email: "me@example.com", emailVerified: true } }, T0)).toBe(false);
    expect(await deleteAccount(me, { sessionId: session.sessionId }, { db, storage, now: T0 })).toEqual({ ok: false, code: "REAUTH_REQUIRED" });
    expect(await recordReauthentication(db, { sessionId: session.sessionId, userId: me.userId, provider: "telegram", claims: tg("me-tg") }, T0)).toBe(true);
    expect(await deleteAccount(me, { sessionId: session.sessionId }, { db, storage, now: at(T0, minutes(1)) })).toEqual({ ok: true });
    // Deletion scrubs the username and keeps the subject, so the same Telegram account is told about the deletion.
    const row = await db.authIdentity.findUniqueOrThrow({ where: { provider_providerSubject: { provider: "TELEGRAM", providerSubject: "me-tg" } } });
    expect(row).toMatchObject({ email: null, displayName: null, providerUsername: null });
    expect(row.releasedAt).not.toBeNull();
    expect(await signInWithIdentity(db, "telegram", tg("me-tg"), at(T0, minutes(2)))).toEqual({ kind: "deleted", subject: "me-tg" });
    // Only the explicit choice creates a fresh account, for this provider's identity only.
    await expect(createFreshAccountForIdentity(db, "google", tg("me-tg"), at(T0, minutes(3)))).rejects.toBeInstanceOf(InvalidStateError);
    const fresh = await createFreshAccountForIdentity(db, "telegram", tg("me-tg", { username: "me_again" }), at(T0, minutes(3)));
    expect(fresh.previousUserId).toBe(me.userId);
    const moved = await db.authIdentity.findUniqueOrThrow({ where: { provider_providerSubject: { provider: "TELEGRAM", providerSubject: "me-tg" } } });
    expect(moved).toMatchObject({ userId: fresh.userId, providerUsername: "me_again", email: null, releasedAt: null });
    expect(await signInWithIdentity(db, "telegram", tg("me-tg"), at(T0, minutes(4)))).toMatchObject({ kind: "signed-in", userId: fresh.userId, destination: "onboarding" });
  });
});

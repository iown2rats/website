import { createSign, generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "@/lib/env";
import { InvalidStateError } from "@/lib/errors";
import { hashPhone } from "@/lib/hashing";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { createFreshAccountForIdentity, getSignInIdentity, recordReauthentication, signInWithIdentity } from "@/server/auth/identity";
import { assertClaims, decodeJwt, signHs256, TokenError, toB64url, type VerifiedClaims } from "@/server/auth/jwt";
import { createPkcePair, DEV_OIDC, DevOidcProvider, GOOGLE, GoogleOidcProvider, OidcExchangeError, pkceChallenge } from "@/server/auth/oidc";
import { normalizeMaldivianPhone } from "@/server/auth/phone";
import { consumeRecentAuthentication, getRecentAuthentication, RECENT_AUTH } from "@/server/auth/recent-auth";
import { createSession, resolveSession } from "@/server/auth/session";
import { getFeed } from "@/server/community/feed";
import { createPost } from "@/server/community/posts";
import { getCommunityProfile } from "@/server/community/profile";
import { canView, getDeckCandidateIds } from "@/server/discovery/query";
import { likeUser } from "@/server/likes/like";
import { addContactHashes } from "@/server/privacy/contact-hashes";
import { deleteAccount } from "@/server/users/deletion";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createIdentity, createUser, minutes } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const CLIENT_ID = "123-test.apps.googleusercontent.com";

const claimsFor = (subject: string, email = `${subject}@example.com`, name: string | null = "Test Person"): VerifiedClaims => ({ subject, email, emailVerified: true, name, username: null, authTime: null, issuedAt: T0 });

/** A fake Google: RSA key pair, JWKS document and an RS256 signer. */
function fakeGoogle() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const jwks = { keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] };
  const sign = (payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }) => {
    const h = toB64url(JSON.stringify(header));
    const p = toB64url(JSON.stringify(payload));
    const signer = createSign("RSA-SHA256");
    signer.update(`${h}.${p}`);
    return `${h}.${p}.${signer.sign(privateKey).toString("base64url")}`;
  };
  return { jwks, sign };
}

const validPayload = (nonce: string, overrides: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  sub: "10769150350006150715113082367",
  email: "person@gmail.com",
  email_verified: true,
  name: "Person Example",
  nonce,
  iat: Math.floor(T0.getTime() / 1000) - 5,
  exp: Math.floor(T0.getTime() / 1000) + 3600,
  ...overrides,
});

beforeEach(() => resetDb(db));
afterEach(() => resetEnvCache());
afterAll(() => disconnectDb());

describe("ID token verification (Google)", () => {
  it("accepts a valid RS256 token from the JWKS and returns normalised claims", async () => {
    const g = fakeGoogle();
    const provider = new GoogleOidcProvider({ clientId: CLIENT_ID, clientSecret: "s", jwksLoader: async () => g.jwks });
    const claims = await provider.verifyIdToken(g.sign(validPayload("n1", { email: "Person@Gmail.com " })), { nonce: "n1", now: T0 });
    expect(claims).toMatchObject({ subject: "10769150350006150715113082367", email: "person@gmail.com", emailVerified: true, name: "Person Example" });
  });

  it("rejects wrong issuer, audience, expiry, nonce, unverified email, unknown key, tampered payload and non-RS256 algorithms", async () => {
    const g = fakeGoogle();
    const provider = new GoogleOidcProvider({ clientId: CLIENT_ID, clientSecret: "s", jwksLoader: async () => g.jwks });
    const cases: [string, string][] = [
      ["issuer", g.sign(validPayload("n", { iss: "https://evil.example" }))],
      ["audience", g.sign(validPayload("n", { aud: "other-client" }))],
      ["expired", g.sign(validPayload("n", { exp: Math.floor(T0.getTime() / 1000) - 120 }))],
      ["nonce", g.sign(validPayload("other"))],
      ["email not verified by Google", g.sign(validPayload("n", { email_verified: false }))],
      ["signature", g.sign(validPayload("n"), { alg: "RS256", kid: "unknown-kid", typ: "JWT" })],
      ["algorithm", signHs256(validPayload("n"), Buffer.from("x".repeat(32)))],
      ["algorithm", g.sign(validPayload("n"), { alg: "none", kid: "k1" })],
    ];
    for (const [reason, token] of cases) {
      await expect(provider.verifyIdToken(token, { nonce: "n", now: T0 }), reason).rejects.toThrow(new RegExp(reason));
    }
    // Tampered payload: signature no longer matches.
    const good = g.sign(validPayload("n"));
    const [h, , sig] = good.split(".");
    const tampered = `${h}.${toB64url(JSON.stringify(validPayload("n", { sub: "attacker" })))}.${sig}`;
    await expect(provider.verifyIdToken(tampered, { nonce: "n", now: T0 })).rejects.toBeInstanceOf(TokenError);
    expect(() => decodeJwt("not-a-jwt")).toThrow(TokenError);
    expect(() => assertClaims({}, { issuers: GOOGLE.issuers, audience: CLIENT_ID, nonce: "n", now: T0 })).toThrow(/issuer/);
  });

  it("builds a PKCE/state/nonce authorization request and exchanges the code with the verifier and client secret", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify({ id_token: "token" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const provider = new GoogleOidcProvider({ clientId: CLIENT_ID, clientSecret: "secret-1", fetchImpl });
    const { codeVerifier, codeChallenge } = createPkcePair();
    const url = new URL(provider.authorizationUrl({ redirectUri: "https://thundi.mv/auth/google/callback", state: "st", nonce: "no", codeChallenge, selectAccount: true, loginHint: "me@example.com" }));
    expect(url.origin + url.pathname).toBe(GOOGLE.authorizationEndpoint);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: CLIENT_ID, response_type: "code", scope: "openid email profile", state: "st", nonce: "no", code_challenge: codeChallenge, code_challenge_method: "S256", prompt: "select_account", login_hint: "me@example.com" });
    expect(codeChallenge).toBe(pkceChallenge(codeVerifier));
    const { idToken } = await provider.exchangeCode({ code: "abc", codeVerifier, redirectUri: "https://thundi.mv/auth/google/callback" });
    expect(idToken).toBe("token");
    const body = new URLSearchParams(calls[0]!.body);
    expect(calls[0]!.url).toBe(GOOGLE.tokenEndpoint);
    expect(Object.fromEntries(body)).toMatchObject({ code: "abc", code_verifier: codeVerifier, client_id: CLIENT_ID, client_secret: "secret-1", grant_type: "authorization_code" });
    const failing = new GoogleOidcProvider({ clientId: CLIENT_ID, clientSecret: "s", fetchImpl: async () => new Response("{}", { status: 400 }) });
    await expect(failing.exchangeCode({ code: "x", codeVerifier, redirectUri: "r" })).rejects.toBeInstanceOf(OidcExchangeError);
  });
});

describe("development identity provider (same contract, local only)", () => {
  const provider = new DevOidcProvider("http://localhost:3100", "s".repeat(40));
  const redirectUri = "http://localhost:3100/auth/google/callback";

  it("issues codes bound to redirect URI, nonce and PKCE, and mints tokens that verify only with the right nonce", async () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    const code = provider.issueCode({ sub: "dev-me", email: "me@demo.thundi.dev", name: "Ismail" }, { redirectUri, nonce: "n1", codeChallenge }, T0);
    const { idToken } = await provider.exchangeCode({ code, codeVerifier, redirectUri }, at(T0, 1000));
    const claims = await provider.verifyIdToken(idToken, { nonce: "n1", now: at(T0, 2000) });
    expect(claims).toMatchObject({ subject: "dev-me", email: "me@demo.thundi.dev", emailVerified: true, name: "Ismail" });
    expect(decodeJwt(idToken).payload).toMatchObject({ iss: DEV_OIDC.issuer, aud: DEV_OIDC.audience });
    await expect(provider.verifyIdToken(idToken, { nonce: "other", now: at(T0, 2000) })).rejects.toThrow(/nonce/);
    await expect(provider.exchangeCode({ code, codeVerifier: "wrong-verifier", redirectUri }, at(T0, 1000))).rejects.toThrow(/pkce/);
    await expect(provider.exchangeCode({ code, codeVerifier, redirectUri: "http://evil.example/cb" }, at(T0, 1000))).rejects.toThrow(/redirect_uri/);
    await expect(provider.exchangeCode({ code, codeVerifier, redirectUri }, at(T0, DEV_OIDC.codeTtlMs + 1000))).rejects.toThrow(/expired/);
    const [payload] = code.split(".");
    await expect(provider.exchangeCode({ code: `${payload}.AAAA`, codeVerifier, redirectUri }, T0)).rejects.toThrow(/signature/);
    // A token from a provider with a different secret is rejected.
    const other = new DevOidcProvider("http://localhost:3100", "t".repeat(40));
    await expect(other.verifyIdToken(idToken, { nonce: "n1", now: at(T0, 2000) })).rejects.toThrow(/signature/);
  });

  it("is refused by the environment in production, which also requires Google client credentials", () => {
    const original = { ...process.env };
    try {
      Object.assign(process.env, { NODE_ENV: "production", AUTH_PROVIDER: "dev", STORAGE_PROVIDER: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" });
      resetEnvCache();
      expect(() => getEnv()).toThrow(/AUTH_PROVIDER/);
      delete process.env.AUTH_PROVIDER; // production defaults to google …
      resetEnvCache();
      expect(() => getEnv()).toThrow(/GOOGLE_CLIENT_ID/); // … and needs the client
      Object.assign(process.env, { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
      resetEnvCache();
      expect(getEnv().AUTH_PROVIDER).toBe("google");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in original)) delete process.env[k];
      Object.assign(process.env, original);
      resetEnvCache();
    }
  });
});

describe("identity → User mapping", () => {
  it("first sign-in creates one ONBOARDING account (verification NONE, no phone); returning sign-ins map to the same User.id", async () => {
    const first = await signInWithIdentity(db, "google", claimsFor("sub-1", "a@example.com"), T0);
    expect(first).toMatchObject({ kind: "signed-in", destination: "onboarding", isNewAccount: true });
    if (first.kind !== "signed-in") throw new Error("expected sign-in");
    const user = await db.user.findUniqueOrThrow({ where: { id: first.userId }, include: { verification: true, privacy: true, discoveryPreferences: true, notificationSettings: true, identities: true } });
    expect(user.status).toBe("ONBOARDING");
    expect(user.phoneE164).toBeNull();
    expect(user.verification?.status).toBe("NONE");
    expect(user.privacy && user.discoveryPreferences && user.notificationSettings).toBeTruthy();
    expect(user.identities[0]).toMatchObject({ provider: "GOOGLE", providerSubject: "sub-1", email: "a@example.com" });
    // Same subject with a changed email/name still lands on the same account; the identity row refreshes.
    const again = await signInWithIdentity(db, "google", claimsFor("sub-1", "renamed@example.com", "New Name"), at(T0, 1000));
    expect(again).toMatchObject({ kind: "signed-in", userId: first.userId, isNewAccount: false });
    expect(await db.user.count()).toBe(1);
    expect(await getSignInIdentity(db, first.userId)).toEqual({ provider: "google", email: "renamed@example.com", name: "New Name", username: null });
    // A different subject with the same email is a different person (Google subjects are the key, never emails).
    const other = await signInWithIdentity(db, "google", claimsFor("sub-2", "renamed@example.com"), at(T0, 2000));
    expect(other.kind === "signed-in" && other.userId !== first.userId).toBe(true);
  });

  it("concurrent first sign-ins for one subject converge on a single account", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => signInWithIdentity(db, "google", claimsFor("race"), T0)));
    const ids = new Set(results.map((r) => (r.kind === "signed-in" ? r.userId : r.kind)));
    expect(ids.size).toBe(1);
    expect(await db.user.count()).toBe(1);
    expect(await db.authIdentity.count()).toBe(1);
  });

  it("an existing completed account signs in to the app; suspended and banned accounts get no session", async () => {
    const active = await createUser(db, { now: T0 });
    const identity = await createIdentity(db, active.userId);
    expect(await signInWithIdentity(db, "google", claimsFor(identity.subject, identity.email), T0)).toMatchObject({ kind: "signed-in", userId: active.userId, destination: "app" });
    for (const status of ["SUSPENDED", "BANNED"] as const) {
      const u = await createUser(db, { now: T0 });
      const i = await createIdentity(db, u.userId);
      await db.user.update({ where: { id: u.userId }, data: { status } });
      expect(await signInWithIdentity(db, "google", claimsFor(i.subject, i.email), T0)).toEqual({ kind: "unavailable" });
    }
  });
});

describe("deleted accounts and the same Google account", () => {
  it("signing in after deletion never revives the profile: the caller is told, and only an explicit choice creates a NEW account", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0, name: "Old" });
    const identity = await createIdentity(db, me.userId, { email: "same@example.com" });
    const session = await createSession(db, me.userId, {}, T0);
    await recordReauthentication(db, { sessionId: session.sessionId, userId: me.userId, provider: "google", claims: claimsFor(identity.subject, identity.email) }, T0);
    expect(await deleteAccount(me, { sessionId: session.sessionId }, { db, storage, now: at(T0, minutes(1)) })).toEqual({ ok: true });

    const outcome = await signInWithIdentity(db, "google", claimsFor(identity.subject, identity.email), at(T0, minutes(2)));
    expect(outcome).toEqual({ kind: "deleted", subject: identity.subject });
    expect((await db.user.findUniqueOrThrow({ where: { id: me.userId } })).status).toBe("DELETED");
    expect(await db.session.count({ where: { userId: me.userId } })).toBe(0);

    const fresh = await createFreshAccountForIdentity(db, "google", claimsFor(identity.subject, identity.email), at(T0, minutes(3)));
    expect(fresh.previousUserId).toBe(me.userId);
    expect(fresh.userId).not.toBe(me.userId);
    const newUser = await db.user.findUniqueOrThrow({ where: { id: fresh.userId }, include: { profile: true, verification: true } });
    expect(newUser).toMatchObject({ status: "ONBOARDING", onboardingStage: "NAME" });
    expect(newUser.profile).toBeNull(); // nothing carried over
    expect(newUser.verification?.status).toBe("NONE");
    const old = await db.user.findUniqueOrThrow({ where: { id: me.userId }, include: { profile: true, identities: true } });
    expect(old.status).toBe("DELETED");
    expect(old.profile?.displayName).toBe("Deleted member");
    expect(old.identities).toHaveLength(0); // the identity moved to the new account
    expect(await db.auditLog.count({ where: { action: "account.recreated", targetId: fresh.userId } })).toBe(1);
    // From now on the identity signs into the new account, and "fresh account" is refused while it is live.
    expect(await signInWithIdentity(db, "google", claimsFor(identity.subject, identity.email), at(T0, minutes(4)))).toMatchObject({ kind: "signed-in", userId: fresh.userId, destination: "onboarding" });
    await expect(createFreshAccountForIdentity(db, "google", claimsFor(identity.subject, identity.email), at(T0, minutes(5)))).rejects.toBeInstanceOf(InvalidStateError);
    // The choice is only for identities that actually belong to a deleted account.
    await expect(createFreshAccountForIdentity(db, "google", claimsFor("never-seen"), T0)).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe("recent authentication", () => {
  it("marks only the requesting session, only for the same identity, expires after the window and is consumed once", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const identity = await createIdentity(db, me.userId);
    const stranger = await createUser(db, { now: T0 });
    const strangerIdentity = await createIdentity(db, stranger.userId);
    const a = await createSession(db, me.userId, {}, T0);
    const b = await createSession(db, me.userId, {}, T0);
    expect(await getRecentAuthentication(db, a.sessionId, T0)).toEqual({ fresh: false, expiresAt: null });
    expect(await recordReauthentication(db, { sessionId: a.sessionId, userId: me.userId, provider: "google", claims: claimsFor(strangerIdentity.subject) }, T0)).toBe(false);
    expect(await recordReauthentication(db, { sessionId: a.sessionId, userId: me.userId, provider: "google", claims: claimsFor(identity.subject) }, T0)).toBe(true);
    expect(await getRecentAuthentication(db, a.sessionId, at(T0, 1000))).toEqual({ fresh: true, expiresAt: at(T0, RECENT_AUTH.windowMs) });
    expect((await getRecentAuthentication(db, b.sessionId, at(T0, 1000))).fresh).toBe(false);
    expect((await getRecentAuthentication(db, a.sessionId, at(T0, RECENT_AUTH.windowMs + 1))).fresh).toBe(false);
    expect(await consumeRecentAuthentication(db, a.sessionId, at(T0, RECENT_AUTH.windowMs + 1))).toBe(false);
    await recordReauthentication(db, { sessionId: a.sessionId, userId: me.userId, provider: "google", claims: claimsFor(identity.subject) }, at(T0, minutes(10)));
    expect(await consumeRecentAuthentication(db, a.sessionId, at(T0, minutes(11)))).toBe(true);
    expect(await consumeRecentAuthentication(db, a.sessionId, at(T0, minutes(11)))).toBe(false); // used up
    // The session itself keeps working as a normal session throughout.
    expect((await resolveSession(db, a.token, at(T0, minutes(12))))?.user.id).toBe(me.userId);
  });
});

describe("phone as optional data", () => {
  it("accounts without a phone work everywhere; contact blocking still applies through the lists that exist", async () => {
    const a = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN", ageMin: 20, ageMax: 40, phone: null });
    const b = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40, phone: null });
    const c = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", ageMin: 20, ageMax: 40 }); // has a number
    expect(await canView(db, a.userId, b.userId, T0)).toBe(true);
    expect(await getDeckCandidateIds(db, a, { now: T0 })).toEqual(expect.arrayContaining([b.userId, c.userId]));
    const post = await createPost(b, { kind: "TEXT", body: "No phone, still here" }, { db, storage, now: T0 });
    expect((await getFeed(a, {}, { db, storage, now: at(T0, 1000) })).posts.map((p) => p.id)).toContain(post.id);
    expect((await getCommunityProfile(a, b.handle, { db, storage, now: T0 })).name).toBeTruthy();
    expect((await likeUser(a, b.userId, { db, now: T0 })).matched).toBe(false);
    // a hides from c by adding c's number to her list: c can no longer see a, even though a has no number herself.
    const normalized = normalizeMaldivianPhone(c.phoneE164);
    if (!normalized.ok) throw new Error("setup");
    await addContactHashes(a, { hashes: [Buffer.from(hashPhone(normalized.e164)).toString("hex")], source: "MANUAL" }, { db, now: T0 });
    await db.privacySettings.update({ where: { userId: a.userId }, data: { blockContacts: true } });
    expect(await canView(db, c.userId, a.userId, at(T0, 1000))).toBe(false);
    expect(await canView(db, a.userId, c.userId, at(T0, 1000))).toBe(false);
    // Nobody can hide from a through a number she never gave us; b (no number) is unaffected by anyone's list.
    await addContactHashes(c, { hashes: [Buffer.from(hashPhone("+9607000000")).toString("hex")], source: "MANUAL" }, { db, now: T0 });
    await db.privacySettings.update({ where: { userId: c.userId }, data: { blockContacts: true } });
    expect(await canView(db, c.userId, b.userId, at(T0, 2000))).toBe(true);
  });
});

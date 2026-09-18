/**
 * OpenID Connect providers (docs/ARCHITECTURE.md §4.1). Sign-in is Google or Telegram, both through the same
 * authorization-code flow with PKCE, state and nonce:
 *  - GoogleOidcProvider: Google's endpoints; the ID token's RS256 signature is verified against Google's JWKS and
 *    its claims are checked explicitly (email required and verified).
 *  - TelegramOidcProvider: Telegram's OpenID Connect service (oauth.telegram.org, BotFather "Login Widget"). Same
 *    verification against Telegram's JWKS; Telegram issues no email claim, so none is required. The client secret is
 *    sent with HTTP Basic authentication to the token endpoint and never leaves the server.
 *  - DevOidcProvider: development/test stand-in that issues its own signed codes and HS256 ID tokens through the
 *    identical flow for either provider shape (so the callback, cookies and mapping code are exercised for real).
 *    Refused in production.
 * Nothing here knows about users or sessions; it only turns a callback into verified identity claims.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual, type JsonWebKey } from "node:crypto";
import { getEnv, telegramLoginEnabled } from "@/lib/env";
import { assertClaims, decodeJwt, signHs256, toB64url, TokenError, verifyHs256, verifyRs256, type VerifiedClaims } from "./jwt";

/**
 * The sign-in methods offered to people. Each maps to one AuthProvider enum value in the database. "email" is not an
 * OpenID Connect provider — it has no authorization server and no ID token — so the OIDC machinery below covers only
 * `OidcSignInProvider`; email + password lives in `email-identity.ts` and shares the identity model, not the flow.
 */
export type SignInProvider = "google" | "telegram" | "email";
export type OidcSignInProvider = "google" | "telegram";
export const SIGN_IN_PROVIDERS: readonly SignInProvider[] = ["google", "telegram", "email"];
export const PROVIDER_LABEL: Record<SignInProvider, string> = { google: "Google", telegram: "Telegram", email: "Email" };
export const PROVIDER_ENUM = { google: "GOOGLE", telegram: "TELEGRAM", email: "EMAIL" } as const satisfies Record<SignInProvider, "GOOGLE" | "TELEGRAM" | "EMAIL">;
export type AuthProviderEnum = (typeof PROVIDER_ENUM)[SignInProvider];

/** The two providers that really run an OpenID Connect flow (the welcome screen's Google and Telegram buttons). */
export function isSignInProvider(value: unknown): value is OidcSignInProvider {
  return value === "google" || value === "telegram";
}

export interface AuthorizationRequest {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /** A previously used email, to preselect the same account on re-authentication. */
  loginHint?: string | null;
  /** Force Google's account chooser (used for re-authentication). */
  selectAccount?: boolean;
}

export interface CodeExchange {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface OidcProvider {
  readonly id: "google" | "telegram" | "dev";
  /** Which sign-in method this instance serves (the dev stand-in serves either). */
  readonly kind: OidcSignInProvider;
  authorizationUrl(req: AuthorizationRequest): string;
  exchangeCode(input: CodeExchange, now?: Date): Promise<{ idToken: string }>;
  verifyIdToken(idToken: string, expected: { nonce: string; now?: Date }): Promise<VerifiedClaims>;
}

export class OidcExchangeError extends Error {
  constructor(readonly reason: string) {
    super(`Sign-in failed: ${reason}`);
    this.name = "OidcExchangeError";
  }
}

/** PKCE (RFC 7636): a high-entropy verifier and its S256 challenge. */
export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(48).toString("base64url");
  return { codeVerifier, codeChallenge: pkceChallenge(codeVerifier) };
}
export function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}
export const randomToken = () => randomBytes(24).toString("base64url");

// ───────────────────────────── RS256 + JWKS base ─────────────────────────────

interface Jwks {
  keys: (JsonWebKey & { kid?: string; alg?: string; use?: string })[];
}

export interface JwksProviderDeps {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  /** Test hook: supplies the JWKS instead of fetching it. */
  jwksLoader?: () => Promise<Jwks>;
}

const JWKS_TTL_MS = 3_600_000;

/** Shared by Google and Telegram: cached JWKS, one refresh on an unknown key id, RS256 only. */
abstract class JwksRs256Provider {
  private jwksCache: { keys: Jwks; loadedAt: number } | null = null;
  protected constructor(protected readonly deps: JwksProviderDeps, private readonly jwksUri: string) {}

  private async jwks(now: Date, force = false): Promise<Jwks> {
    if (!force && this.jwksCache && now.getTime() - this.jwksCache.loadedAt < JWKS_TTL_MS) return this.jwksCache.keys;
    const loader = this.deps.jwksLoader ?? (async () => {
      const res = await (this.deps.fetchImpl ?? fetch)(this.jwksUri);
      if (!res.ok) throw new OidcExchangeError(`jwks ${res.status}`);
      return (await res.json()) as Jwks;
    });
    const keys = await loader();
    this.jwksCache = { keys, loadedAt: now.getTime() };
    return keys;
  }

  /** Decodes, checks the algorithm, finds the key (refreshing once on rotation) and verifies the signature. */
  protected async verifySignature(idToken: string, now: Date) {
    const parts = decodeJwt(idToken);
    if (parts.header.alg !== "RS256" || !parts.header.kid) throw new TokenError("algorithm");
    let jwks = await this.jwks(now);
    let key = jwks.keys.find((k) => k.kid === parts.header.kid);
    if (!key) {
      jwks = await this.jwks(now, true);
      key = jwks.keys.find((k) => k.kid === parts.header.kid);
    }
    if (!key || !verifyRs256(parts, key)) throw new TokenError("signature");
    return parts;
  }
}

// ───────────────────────────── Google ─────────────────────────────

export const GOOGLE = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"] as const,
  scope: "openid email profile",
  jwksTtlMs: JWKS_TTL_MS,
} as const;

export type GoogleProviderDeps = JwksProviderDeps;

export class GoogleOidcProvider extends JwksRs256Provider implements OidcProvider {
  readonly id = "google" as const;
  readonly kind = "google" as const;
  constructor(deps: GoogleProviderDeps) {
    super(deps, GOOGLE.jwksUri);
  }

  authorizationUrl(req: AuthorizationRequest): string {
    const url = new URL(GOOGLE.authorizationEndpoint);
    url.searchParams.set("client_id", this.deps.clientId);
    url.searchParams.set("redirect_uri", req.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE.scope);
    url.searchParams.set("state", req.state);
    url.searchParams.set("nonce", req.nonce);
    url.searchParams.set("code_challenge", req.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (req.selectAccount) url.searchParams.set("prompt", "select_account");
    if (req.loginHint) url.searchParams.set("login_hint", req.loginHint);
    return url.toString();
  }

  async exchangeCode(input: CodeExchange): Promise<{ idToken: string }> {
    const f = this.deps.fetchImpl ?? fetch;
    const body = new URLSearchParams({
      code: input.code,
      client_id: this.deps.clientId,
      client_secret: this.deps.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    });
    const res = await f(GOOGLE.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (!res.ok) throw new OidcExchangeError(`token endpoint ${res.status}`);
    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) throw new OidcExchangeError("no id_token");
    return { idToken: json.id_token };
  }

  async verifyIdToken(idToken: string, expected: { nonce: string; now?: Date }): Promise<VerifiedClaims> {
    const now = expected.now ?? new Date();
    const parts = await this.verifySignature(idToken, now);
    const claims = assertClaims(parts.payload, { issuers: GOOGLE.issuers, audience: this.deps.clientId, nonce: expected.nonce, now });
    if (!claims.emailVerified) throw new TokenError("email not verified by Google");
    return claims;
  }
}

// ───────────────────────────── Telegram ─────────────────────────────

/**
 * Telegram's OpenID Connect service. Discovery lives at https://oauth.telegram.org/.well-known/openid-configuration;
 * the endpoints are pinned here so a discovery outage or a tampered document cannot redirect the flow. ID tokens
 * are RS256 (BotFather's default; the app rejects any other algorithm). There is no userinfo endpoint: every
 * claim comes from the ID token. `sub` is the Telegram user id, `name`/`given_name`/`family_name` the display
 * name, `preferred_username` the @username when the person has one. No email is issued and none is requested.
 */
export const TELEGRAM = {
  issuer: "https://oauth.telegram.org",
  authorizationEndpoint: "https://oauth.telegram.org/auth",
  tokenEndpoint: "https://oauth.telegram.org/token",
  jwksUri: "https://oauth.telegram.org/.well-known/jwks.json",
  scope: "openid profile",
} as const;

export type TelegramProviderDeps = JwksProviderDeps;

export class TelegramOidcProvider extends JwksRs256Provider implements OidcProvider {
  readonly id = "telegram" as const;
  readonly kind = "telegram" as const;
  constructor(deps: TelegramProviderDeps) {
    super(deps, TELEGRAM.jwksUri);
  }

  authorizationUrl(req: AuthorizationRequest): string {
    const url = new URL(TELEGRAM.authorizationEndpoint);
    url.searchParams.set("client_id", this.deps.clientId);
    url.searchParams.set("redirect_uri", req.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", TELEGRAM.scope);
    url.searchParams.set("state", req.state);
    url.searchParams.set("nonce", req.nonce);
    url.searchParams.set("code_challenge", req.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    // Telegram shows its own account confirmation; there is no account chooser or login hint to pass.
    return url.toString();
  }

  /** Confidential client: RFC 6749 §2.3.1 HTTP Basic (which every authorization server must support), plus PKCE. */
  async exchangeCode(input: CodeExchange): Promise<{ idToken: string }> {
    const f = this.deps.fetchImpl ?? fetch;
    const body = new URLSearchParams({
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    });
    const basic = Buffer.from(`${encodeURIComponent(this.deps.clientId)}:${encodeURIComponent(this.deps.clientSecret)}`).toString("base64");
    const res = await f(TELEGRAM.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", authorization: `Basic ${basic}` },
      body,
    });
    if (!res.ok) throw new OidcExchangeError(`token endpoint ${res.status}`);
    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) throw new OidcExchangeError("no id_token");
    return { idToken: json.id_token };
  }

  async verifyIdToken(idToken: string, expected: { nonce: string; now?: Date }): Promise<VerifiedClaims> {
    const now = expected.now ?? new Date();
    const parts = await this.verifySignature(idToken, now);
    return assertClaims(parts.payload, { issuers: [TELEGRAM.issuer], audience: this.deps.clientId, nonce: expected.nonce, now, requireEmail: false });
  }
}

// ───────────────────────────── Development stand-in ─────────────────────────────

export const DEV_OIDC = {
  issuer: "https://dev-google.thundi.local",
  issuers: { google: "https://dev-google.thundi.local", telegram: "https://dev-telegram.thundi.local" } as Record<OidcSignInProvider, string>,
  audience: "thundi-dev",
  codeTtlMs: 10 * 60_000,
  idTokenTtlMs: 5 * 60_000,
} as const;

export interface DevIdentityInput {
  sub: string;
  /** Required for the Google shape; ignored for Telegram, which issues no email. */
  email?: string | null;
  name?: string | null;
  /** Telegram shape only. */
  username?: string | null;
}

/**
 * Local identity provider used when AUTH_PROVIDER=dev. Its "authorization server" is /dev/google/authorize, which
 * lets the developer pick a seeded identity or type one, then issues a signed code bound to the redirect URI,
 * nonce and PKCE challenge — exactly the contract the app expects from Google or Telegram. One instance per
 * provider shape: the Telegram shape mints tokens with no email and a `preferred_username`, under its own issuer.
 */
export class DevOidcProvider implements OidcProvider {
  readonly id = "dev" as const;
  private readonly codeKey: Buffer;
  private readonly tokenKey: Buffer;
  constructor(private readonly appUrl: string, secret: string, readonly kind: OidcSignInProvider = "google") {
    this.codeKey = createHmac("sha256", secret).update(`dev-oidc-code:${kind}`).digest();
    this.tokenKey = createHmac("sha256", secret).update(`dev-oidc-id-token:${kind}`).digest();
  }

  authorizationUrl(req: AuthorizationRequest): string {
    const url = new URL("/dev/google/authorize", this.appUrl);
    url.searchParams.set("provider", this.kind);
    url.searchParams.set("redirect_uri", req.redirectUri);
    url.searchParams.set("state", req.state);
    url.searchParams.set("nonce", req.nonce);
    url.searchParams.set("code_challenge", req.codeChallenge);
    if (req.loginHint) url.searchParams.set("login_hint", req.loginHint);
    if (req.selectAccount) url.searchParams.set("prompt", "select_account");
    return url.toString();
  }

  /** Called by the dev authorization page after the developer chose an identity. */
  issueCode(identity: DevIdentityInput, binding: { redirectUri: string; nonce: string; codeChallenge: string }, now = new Date()): string {
    const payload = toB64url(JSON.stringify({ ...identity, ...binding, iat: now.getTime() }));
    return `${payload}.${toB64url(createHmac("sha256", this.codeKey).update(payload).digest())}`;
  }

  async exchangeCode(input: CodeExchange, now = new Date()): Promise<{ idToken: string }> {
    const [payload, sig] = input.code.split(".");
    if (!payload || !sig) throw new OidcExchangeError("malformed code");
    const expected = createHmac("sha256", this.codeKey).update(payload).digest();
    const given = Buffer.from(sig, "base64url");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new OidcExchangeError("code signature");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DevIdentityInput & { redirectUri: string; nonce: string; codeChallenge: string; iat: number };
    if (now.getTime() - data.iat > DEV_OIDC.codeTtlMs) throw new OidcExchangeError("code expired");
    if (data.redirectUri !== input.redirectUri) throw new OidcExchangeError("redirect_uri mismatch");
    if (data.codeChallenge !== pkceChallenge(input.codeVerifier)) throw new OidcExchangeError("pkce");
    const iat = Math.floor(now.getTime() / 1000);
    const common = { iss: DEV_OIDC.issuers[this.kind], aud: DEV_OIDC.audience, sub: data.sub, name: data.name ?? null, nonce: data.nonce, iat, auth_time: iat, exp: iat + DEV_OIDC.idTokenTtlMs / 1000 };
    const shaped = this.kind === "telegram"
      ? { ...common, preferred_username: data.username ?? undefined }
      : { ...common, email: data.email, email_verified: true };
    return { idToken: signHs256(shaped, this.tokenKey) };
  }

  async verifyIdToken(idToken: string, expected: { nonce: string; now?: Date }): Promise<VerifiedClaims> {
    const parts = decodeJwt(idToken);
    if (!verifyHs256(parts, this.tokenKey)) throw new TokenError("signature");
    return assertClaims(parts.payload, { issuers: [DEV_OIDC.issuers[this.kind]], audience: DEV_OIDC.audience, nonce: expected.nonce, now: expected.now, requireEmail: this.kind === "google" });
  }
}

const cached = new Map<SignInProvider, OidcProvider>();

/**
 * The provider serving a sign-in method. Google is always configured in production; Telegram only when its client
 * is (callers check `telegramLoginEnabled()` first and the routes 404 otherwise). With AUTH_PROVIDER=dev both are
 * the local stand-in.
 */
export function getOidcProvider(kind: OidcSignInProvider = "google"): OidcProvider {
  const hit = cached.get(kind);
  if (hit) return hit;
  const env = getEnv();
  let provider: OidcProvider;
  if (env.AUTH_PROVIDER !== "google") {
    provider = new DevOidcProvider(env.APP_URL, env.SESSION_SECRET, kind);
  } else if (kind === "google") {
    provider = new GoogleOidcProvider({ clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! });
  } else {
    if (!telegramLoginEnabled(env)) throw new Error("Telegram sign-in is not configured (TELEGRAM_CLIENT_ID / TELEGRAM_CLIENT_SECRET)");
    provider = new TelegramOidcProvider({ clientId: env.TELEGRAM_CLIENT_ID!, clientSecret: env.TELEGRAM_CLIENT_SECRET! });
  }
  cached.set(kind, provider);
  return provider;
}

/** Test hook. */
export function resetOidcProviderCache(): void {
  cached.clear();
}

/** The registered callback for a provider: `${APP_URL}/auth/<provider>/callback`, exact match required at the provider. */
export function redirectUri(kind: OidcSignInProvider = "google"): string {
  return new URL(`/auth/${kind}/callback`, getEnv().APP_URL).toString();
}

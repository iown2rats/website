/**
 * OpenID Connect providers (docs/ARCHITECTURE.md §4.1). Sign-in is Google-only:
 *  - GoogleOidcProvider: authorization-code flow with PKCE, state and nonce against Google's endpoints; the ID
 *    token's RS256 signature is verified against Google's JWKS and its claims are checked explicitly.
 *  - DevOidcProvider: development/test stand-in that issues its own signed codes and HS256 ID tokens through the
 *    identical flow (so the callback, cookies and mapping code are exercised for real). Refused in production.
 * Nothing here knows about users or sessions; it only turns a callback into verified identity claims.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual, type JsonWebKey } from "node:crypto";
import { getEnv } from "@/lib/env";
import { assertClaims, decodeJwt, signHs256, toB64url, TokenError, verifyHs256, verifyRs256, type VerifiedClaims } from "./jwt";

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
  readonly id: "google" | "dev";
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

// ───────────────────────────── Google ─────────────────────────────

export const GOOGLE = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"] as const,
  scope: "openid email profile",
  jwksTtlMs: 3_600_000,
} as const;

interface Jwks {
  keys: (JsonWebKey & { kid?: string; alg?: string; use?: string })[];
}

export interface GoogleProviderDeps {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  /** Test hook: supplies the JWKS instead of fetching it. */
  jwksLoader?: () => Promise<Jwks>;
}

export class GoogleOidcProvider implements OidcProvider {
  readonly id = "google" as const;
  private jwksCache: { keys: Jwks; loadedAt: number } | null = null;
  constructor(private readonly deps: GoogleProviderDeps) {}

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

  private async jwks(now: Date, force = false): Promise<Jwks> {
    if (!force && this.jwksCache && now.getTime() - this.jwksCache.loadedAt < GOOGLE.jwksTtlMs) return this.jwksCache.keys;
    const loader = this.deps.jwksLoader ?? (async () => {
      const res = await (this.deps.fetchImpl ?? fetch)(GOOGLE.jwksUri);
      if (!res.ok) throw new OidcExchangeError(`jwks ${res.status}`);
      return (await res.json()) as Jwks;
    });
    const keys = await loader();
    this.jwksCache = { keys, loadedAt: now.getTime() };
    return keys;
  }

  async verifyIdToken(idToken: string, expected: { nonce: string; now?: Date }): Promise<VerifiedClaims> {
    const now = expected.now ?? new Date();
    const parts = decodeJwt(idToken);
    if (parts.header.alg !== "RS256" || !parts.header.kid) throw new TokenError("algorithm");
    let jwks = await this.jwks(now);
    let key = jwks.keys.find((k) => k.kid === parts.header.kid);
    if (!key) {
      // Key rotation: refresh once before giving up.
      jwks = await this.jwks(now, true);
      key = jwks.keys.find((k) => k.kid === parts.header.kid);
    }
    if (!key || !verifyRs256(parts, key)) throw new TokenError("signature");
    const claims = assertClaims(parts.payload, { issuers: GOOGLE.issuers, audience: this.deps.clientId, nonce: expected.nonce, now });
    if (!claims.emailVerified) throw new TokenError("email not verified by Google");
    return claims;
  }
}

// ───────────────────────────── Development stand-in ─────────────────────────────

export const DEV_OIDC = {
  issuer: "https://dev-google.thundi.local",
  audience: "thundi-dev",
  codeTtlMs: 10 * 60_000,
  idTokenTtlMs: 5 * 60_000,
} as const;

export interface DevIdentityInput {
  sub: string;
  email: string;
  name?: string | null;
}

/**
 * Local identity provider used when AUTH_PROVIDER=dev. Its "authorization server" is /dev/google/authorize, which
 * lets the developer pick a seeded identity or type one, then issues a signed code bound to the redirect URI,
 * nonce and PKCE challenge — exactly the contract the app expects from Google.
 */
export class DevOidcProvider implements OidcProvider {
  readonly id = "dev" as const;
  private readonly codeKey: Buffer;
  private readonly tokenKey: Buffer;
  constructor(private readonly appUrl: string, secret: string) {
    this.codeKey = createHmac("sha256", secret).update("dev-oidc-code").digest();
    this.tokenKey = createHmac("sha256", secret).update("dev-oidc-id-token").digest();
  }

  authorizationUrl(req: AuthorizationRequest): string {
    const url = new URL("/dev/google/authorize", this.appUrl);
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
    const idToken = signHs256(
      { iss: DEV_OIDC.issuer, aud: DEV_OIDC.audience, sub: data.sub, email: data.email, email_verified: true, name: data.name ?? null, nonce: data.nonce, iat, auth_time: iat, exp: iat + DEV_OIDC.idTokenTtlMs / 1000 },
      this.tokenKey,
    );
    return { idToken };
  }

  async verifyIdToken(idToken: string, expected: { nonce: string; now?: Date }): Promise<VerifiedClaims> {
    const parts = decodeJwt(idToken);
    if (!verifyHs256(parts, this.tokenKey)) throw new TokenError("signature");
    return assertClaims(parts.payload, { issuers: [DEV_OIDC.issuer], audience: DEV_OIDC.audience, nonce: expected.nonce, now: expected.now });
  }
}

let cached: OidcProvider | null = null;

export function getOidcProvider(): OidcProvider {
  if (cached) return cached;
  const env = getEnv();
  cached = env.AUTH_PROVIDER === "google" ? new GoogleOidcProvider({ clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! }) : new DevOidcProvider(env.APP_URL, env.SESSION_SECRET);
  return cached;
}

/** Test hook. */
export function resetOidcProviderCache(): void {
  cached = null;
}

export function redirectUri(): string {
  return new URL("/auth/google/callback", getEnv().APP_URL).toString();
}

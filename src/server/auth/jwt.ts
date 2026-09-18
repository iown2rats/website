/**
 * Minimal JWS/JWT handling for OpenID Connect ID tokens (docs/ARCHITECTURE.md §4.1). RS256 against a provider's
 * JWK (Google) and HS256 for the development identity provider. Only what sign-in needs; no `alg: none`, no
 * algorithm negotiation from the token header beyond the two supported values, and claim checks are explicit.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify, type JsonWebKey } from "node:crypto";

export class TokenError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid ID token: ${reason}`);
    this.name = "TokenError";
  }
}

export interface JwtParts {
  header: { alg?: string; kid?: string; typ?: string };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
export const toB64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function decodeJwt(token: string): JwtParts {
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenError("malformed");
  const [h, p, s] = parts as [string, string, string];
  let header: JwtParts["header"];
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64url(h).toString("utf8")) as JwtParts["header"];
    payload = JSON.parse(b64url(p).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new TokenError("malformed");
  }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object") throw new TokenError("malformed");
  return { header, payload, signingInput: `${h}.${p}`, signature: b64url(s) };
}

export function verifyRs256(parts: JwtParts, jwk: JsonWebKey): boolean {
  if (parts.header.alg !== "RS256") return false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return cryptoVerify("RSA-SHA256", Buffer.from(parts.signingInput), key, parts.signature);
  } catch {
    return false;
  }
}

export function hs256(signingInput: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(signingInput).digest();
}

export function verifyHs256(parts: JwtParts, key: Buffer): boolean {
  if (parts.header.alg !== "HS256") return false;
  const expected = hs256(parts.signingInput, key);
  return expected.length === parts.signature.length && timingSafeEqual(expected, parts.signature);
}

export function signHs256(payload: Record<string, unknown>, key: Buffer, kid = "dev"): string {
  const header = toB64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid }));
  const body = toB64url(JSON.stringify(payload));
  return `${header}.${body}.${toB64url(hs256(`${header}.${body}`, key))}`;
}

export interface ClaimExpectations {
  issuers: readonly string[];
  audience: string;
  nonce: string;
  now?: Date;
  /** Tolerance for clock skew between us and the provider. */
  skewMs?: number;
  /** Google always issues an email; Telegram never does. Default: required. */
  requireEmail?: boolean;
}

export interface VerifiedClaims {
  subject: string;
  /** Null only for providers that issue no email claim (Telegram). */
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** `preferred_username` without a leading @ (Telegram); null elsewhere. Display only, never an identifier. */
  username: string | null;
  authTime: Date | null;
  issuedAt: Date;
}

const USERNAME = /^[A-Za-z0-9_]{1,64}$/;

/** Validates the standard OIDC claims. Signature verification happens before this. */
export function assertClaims(payload: Record<string, unknown>, e: ClaimExpectations): VerifiedClaims {
  const now = e.now ?? new Date();
  const skew = e.skewMs ?? 60_000;
  if (typeof payload.iss !== "string" || !e.issuers.includes(payload.iss)) throw new TokenError("issuer");
  const aud = payload.aud;
  const audOk = typeof aud === "string" ? aud === e.audience : Array.isArray(aud) && aud.includes(e.audience);
  if (!audOk) throw new TokenError("audience");
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now.getTime() - skew) throw new TokenError("expired");
  if (typeof payload.iat !== "number" || payload.iat * 1000 > now.getTime() + skew) throw new TokenError("issued in the future");
  if (typeof payload.nonce !== "string" || payload.nonce !== e.nonce) throw new TokenError("nonce");
  if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 255) throw new TokenError("subject");
  const hasEmail = typeof payload.email === "string" && payload.email.includes("@");
  if ((e.requireEmail ?? true) && !hasEmail) throw new TokenError("email");
  const rawUsername = typeof payload.preferred_username === "string" ? payload.preferred_username.trim().replace(/^@/, "") : "";
  const given = typeof payload.given_name === "string" ? payload.given_name.trim() : "";
  const family = typeof payload.family_name === "string" ? payload.family_name.trim() : "";
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : `${given} ${family}`.trim();
  return {
    subject: payload.sub,
    email: hasEmail ? (payload.email as string).trim().toLowerCase() : null,
    emailVerified: hasEmail && (payload.email_verified === true || payload.email_verified === "true"),
    name: name ? name.slice(0, 80) : null,
    username: USERNAME.test(rawUsername) ? rawUsername : null,
    authTime: typeof payload.auth_time === "number" ? new Date(payload.auth_time * 1000) : null,
    issuedAt: new Date(payload.iat * 1000),
  };
}

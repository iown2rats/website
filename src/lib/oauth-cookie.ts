/**
 * Short-lived signed cookies for the sign-in flow (docs/ARCHITECTURE.md §4.1). Neither carries a secret the
 * server relies on beyond its own signature: the pending-auth cookie binds the callback to this browser (state),
 * the ID token to this request (nonce) and the code to this client (PKCE verifier); the pending-identity cookie
 * lets the "your previous account was deleted" screen create a new account for the identity that just signed in.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import type { OidcSignInProvider } from "@/server/auth/oidc";

export const OAUTH_COOKIE = "thundi_oauth";
export const PENDING_IDENTITY_COOKIE = "thundi_identity";
export const OAUTH_TTL_MS = 10 * 60_000;

export interface PendingAuth {
  /** Which provider's callback may complete this flow; the other provider's callback refuses it. */
  provider: OidcSignInProvider;
  state: string;
  nonce: string;
  codeVerifier: string;
  purpose: "login" | "reauth";
  /** Same-origin path to return to after a re-authentication. */
  returnTo: string | null;
  /** Session id that requested re-authentication, so the callback can bind the result to it. */
  sessionId: string | null;
  /**
   * Set only when the Android shell started this flow (docs/ARCHITECTURE.md §4.1c): the base64url SHA-256 of a
   * verifier the app generated before it opened the browser. Its presence is what makes the callback hand the
   * result back over a deep link instead of setting a cookie, and it rides in this signed cookie rather than in
   * the redirect so nothing between the browser and the callback can introduce or alter it.
   */
  handoffChallenge?: string | null;
  createdAt: number;
}

export interface PendingIdentity {
  provider: OidcSignInProvider;
  subject: string;
  email: string | null;
  name: string | null;
  username: string | null;
  createdAt: number;
}

function sign(payload: string): string {
  return createHmac("sha256", getEnv().SESSION_SECRET).update(payload).digest("base64url");
}

function encode(value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export async function setPendingAuth(value: PendingAuth): Promise<void> {
  const store = await cookies();
  store.set(OAUTH_COOKIE, encode(value), { ...options, maxAge: OAUTH_TTL_MS / 1000 });
}

export async function readPendingAuth(now = Date.now()): Promise<PendingAuth | null> {
  const store = await cookies();
  const value = decode<PendingAuth>(store.get(OAUTH_COOKIE)?.value);
  if (!value || now - value.createdAt > OAUTH_TTL_MS) return null;
  return value;
}

export async function clearPendingAuth(): Promise<void> {
  const store = await cookies();
  store.set(OAUTH_COOKIE, "", { ...options, maxAge: 0 });
}

export async function setPendingIdentity(value: PendingIdentity): Promise<void> {
  const store = await cookies();
  store.set(PENDING_IDENTITY_COOKIE, encode(value), { ...options, maxAge: OAUTH_TTL_MS / 1000 });
}

export async function readPendingIdentity(now = Date.now()): Promise<PendingIdentity | null> {
  const store = await cookies();
  const value = decode<PendingIdentity>(store.get(PENDING_IDENTITY_COOKIE)?.value);
  if (!value || now - value.createdAt > OAUTH_TTL_MS) return null;
  return value;
}

export async function clearPendingIdentity(): Promise<void> {
  const store = await cookies();
  store.set(PENDING_IDENTITY_COOKIE, "", { ...options, maxAge: 0 });
}

/**
 * The session cookie (docs/ARCHITECTURE.md §4.2): HttpOnly, Secure in production, SameSite=Lax, Path=/.
 * Next-specific; the token itself is managed by src/server/auth/session.ts.
 */
import { cookies } from "next/headers";

export const SESSION_COOKIE = "thundi_session";

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

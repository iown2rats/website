import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { clearPendingAuth, readPendingAuth, setPendingIdentity } from "@/lib/oauth-cookie";
import { readSessionToken, setSessionCookie } from "@/lib/session-cookie";
import { recordReauthentication, signInWithIdentity } from "@/server/auth/identity";
import { getOidcProvider, redirectUri } from "@/server/auth/oidc";
import { ROUTES } from "@/server/auth/route-access";
import { createSession, resolveSession } from "@/server/auth/session";

/**
 * GET /auth/google/callback — completes the flow (docs/ARCHITECTURE.md §4.1). Checks the state against the
 * pending-auth cookie, exchanges the code with the PKCE verifier, verifies the ID token (signature, issuer,
 * audience, expiry, nonce), then either signs the identity in (mapping to our User.id), shows the "previous
 * account deleted" screen, or marks the current session as freshly re-authenticated. Every failure lands on
 * /auth/error with a reason code and no detail about accounts.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pending = await readPendingAuth();
  await clearPendingAuth();
  const fail = (reason: string) => NextResponse.redirect(new URL(`${ROUTES.authError}?reason=${reason}`, request.url));

  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "cancelled" : "provider");
  const code = params.get("code");
  const state = params.get("state");
  if (!pending || !code || !state) return fail("state");
  const a = Buffer.from(state);
  const b = Buffer.from(pending.state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return fail("state");

  const provider = getOidcProvider();
  let claims;
  try {
    const { idToken } = await provider.exchangeCode({ code, codeVerifier: pending.codeVerifier, redirectUri: redirectUri() });
    claims = await provider.verifyIdToken(idToken, { nonce: pending.nonce });
  } catch (e) {
    console.warn("[auth] google callback rejected:", e instanceof Error ? e.message : e);
    return fail("token");
  }

  const db = getDb();
  const now = new Date();
  if (pending.purpose === "reauth") {
    const resolved = await resolveSession(db, await readSessionToken(), now);
    if (!resolved || resolved.sessionId !== pending.sessionId) return fail("session");
    const ok = await recordReauthentication(db, { sessionId: resolved.sessionId, userId: resolved.user.id, claims }, now);
    if (!ok) return fail("identity");
    return NextResponse.redirect(new URL(pending.returnTo ?? "/settings", request.url));
  }

  const outcome = await signInWithIdentity(db, claims, now);
  if (outcome.kind === "unavailable") return fail("unavailable");
  if (outcome.kind === "deleted") {
    await setPendingIdentity({ subject: claims.subject, email: claims.email, name: claims.name, createdAt: Date.now() });
    return NextResponse.redirect(new URL(ROUTES.deleted, request.url));
  }
  const forwarded = request.headers.get("x-forwarded-for");
  const session = await createSession(db, outcome.userId, { ip: forwarded ? forwarded.split(",")[0]!.trim() : null, userAgent: request.headers.get("user-agent") }, now);
  await setSessionCookie(session.token, session.expiresAt);
  return NextResponse.redirect(new URL(outcome.destination === "app" ? ROUTES.home : ROUTES.onboarding, request.url));
}

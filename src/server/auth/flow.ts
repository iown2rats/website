/**
 * The sign-in flow shared by every provider (docs/ARCHITECTURE.md §4.1). The route handlers under
 * /auth/google and /auth/telegram are thin: they name the provider and call these two functions.
 *
 * start: for anonymous visitors begins a sign-in; for a signed-in user `?purpose=reauth` begins a re-authentication
 * with the same identity before a destructive action, bound to this session and returned to `returnTo` (same-origin
 * paths only). State, nonce, the PKCE verifier and the provider live in a signed HttpOnly cookie for ten minutes.
 *
 * complete: checks the state against the pending-auth cookie (and that the cookie belongs to this provider),
 * exchanges the code with the PKCE verifier, verifies the ID token (signature, issuer, audience, expiry, nonce),
 * then either signs the identity in (mapping to our User.id), shows the "previous account deleted" screen, or marks
 * the current session as freshly re-authenticated. Every failure lands on /auth/error with a reason code, the
 * provider (so the screen offers the right button) and no detail about accounts.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { clearPendingAuth, readPendingAuth, setPendingAuth, setPendingIdentity } from "@/lib/oauth-cookie";
import { readSessionToken, setSessionCookie } from "@/lib/session-cookie";
import { getSignInIdentity, recordReauthentication, signInWithIdentity } from "./identity";
import { createPkcePair, getOidcProvider, randomToken, redirectUri, type SignInProvider } from "./oidc";
import { ROUTES, safeInternalPath } from "./route-access";
import { authKindForUser, createSession, resolveSession } from "./session";
import { telegramSignInAvailable } from "./telegram-availability";

/** Google is always on; Telegram needs its client variables and the hosted migration (telegram-availability.ts). */
async function providerAvailable(db: ReturnType<typeof getDb>, provider: SignInProvider): Promise<boolean> {
  return provider === "google" || telegramSignInAvailable(db);
}

export async function startSignIn(request: NextRequest, provider: SignInProvider): Promise<NextResponse> {
  const db = getDb();
  if (!(await providerAvailable(db, provider))) return new NextResponse("Not found", { status: 404 });
  const params = request.nextUrl.searchParams;
  const purpose = params.get("purpose") === "reauth" ? "reauth" : "login";
  const resolved = await resolveSession(db, await readSessionToken());
  const kind = resolved ? authKindForUser(resolved.user) : "anonymous";

  if (purpose === "login" && resolved && kind !== "blocked") {
    return NextResponse.redirect(new URL(kind === "active" ? ROUTES.home : ROUTES.onboarding, request.url));
  }
  if (purpose === "reauth" && (!resolved || kind === "blocked")) {
    return NextResponse.redirect(new URL(ROUTES.welcome, request.url));
  }

  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = randomToken();
  const nonce = randomToken();
  await setPendingAuth({
    provider,
    state,
    nonce,
    codeVerifier,
    purpose,
    returnTo: purpose === "reauth" ? safeInternalPath(params.get("returnTo"), "/settings") : null,
    sessionId: purpose === "reauth" && resolved ? resolved.sessionId : null,
    createdAt: Date.now(),
  });
  // Re-authentication preselects the same Google account; Telegram has no login hint.
  const identity = purpose === "reauth" && resolved ? await getSignInIdentity(db, resolved.user.id) : null;
  const loginHint = identity?.provider === "google" ? identity.email : null;
  const url = getOidcProvider(provider).authorizationUrl({ redirectUri: redirectUri(provider), state, nonce, codeChallenge, loginHint, selectAccount: purpose === "reauth" });
  return NextResponse.redirect(url);
}

export async function completeSignIn(request: NextRequest, provider: SignInProvider): Promise<NextResponse> {
  const db = getDb();
  if (!(await providerAvailable(db, provider))) return new NextResponse("Not found", { status: 404 });
  const params = request.nextUrl.searchParams;
  const pending = await readPendingAuth();
  await clearPendingAuth();
  const fail = (reason: string) => NextResponse.redirect(new URL(`${ROUTES.authError}?reason=${reason}&provider=${provider}`, request.url));

  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "cancelled" : "provider");
  const code = params.get("code");
  const state = params.get("state");
  if (!pending || pending.provider !== provider || !code || !state) return fail("state");
  const a = Buffer.from(state);
  const b = Buffer.from(pending.state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return fail("state");

  const oidc = getOidcProvider(provider);
  let claims;
  try {
    const { idToken } = await oidc.exchangeCode({ code, codeVerifier: pending.codeVerifier, redirectUri: redirectUri(provider) });
    claims = await oidc.verifyIdToken(idToken, { nonce: pending.nonce });
  } catch (e) {
    console.warn(`[auth] ${provider} callback rejected:`, e instanceof Error ? e.message : e);
    return fail("token");
  }

  const now = new Date();
  if (pending.purpose === "reauth") {
    const resolved = await resolveSession(db, await readSessionToken(), now);
    if (!resolved || resolved.sessionId !== pending.sessionId) return fail("session");
    const ok = await recordReauthentication(db, { sessionId: resolved.sessionId, userId: resolved.user.id, provider, claims }, now);
    if (!ok) return fail("identity");
    return NextResponse.redirect(new URL(pending.returnTo ?? "/settings", request.url));
  }

  const outcome = await signInWithIdentity(db, provider, claims, now);
  if (outcome.kind === "unavailable") return fail("unavailable");
  if (outcome.kind === "deleted") {
    await setPendingIdentity({ provider, subject: claims.subject, email: claims.email, name: claims.name, username: claims.username, createdAt: Date.now() });
    return NextResponse.redirect(new URL(ROUTES.deleted, request.url));
  }
  const forwarded = request.headers.get("x-forwarded-for");
  const session = await createSession(db, outcome.userId, { ip: forwarded ? forwarded.split(",")[0]!.trim() : null, userAgent: request.headers.get("user-agent") }, now);
  await setSessionCookie(session.token, session.expiresAt);
  return NextResponse.redirect(new URL(outcome.destination === "app" ? ROUTES.home : ROUTES.onboarding, request.url));
}

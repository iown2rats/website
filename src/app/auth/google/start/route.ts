import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { setPendingAuth } from "@/lib/oauth-cookie";
import { readSessionToken } from "@/lib/session-cookie";
import { getSignInIdentity } from "@/server/auth/identity";
import { createPkcePair, getOidcProvider, randomToken, redirectUri } from "@/server/auth/oidc";
import { ROUTES, safeInternalPath } from "@/server/auth/route-access";
import { authKindForUser, resolveSession } from "@/server/auth/session";

/**
 * GET /auth/google/start — begins "Continue with Google" (docs/ARCHITECTURE.md §4.1).
 * Default purpose `login`: for anonymous visitors; signed-in users are sent where they belong.
 * `?purpose=reauth`: a signed-in user re-authenticates with the same Google identity before a destructive action;
 * the result is bound to this session and returned to `returnTo` (same-origin paths only).
 * State, nonce and the PKCE verifier live in a signed HttpOnly cookie for ten minutes.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const purpose = params.get("purpose") === "reauth" ? "reauth" : "login";
  const db = getDb();
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
    state,
    nonce,
    codeVerifier,
    purpose,
    returnTo: purpose === "reauth" ? safeInternalPath(params.get("returnTo"), "/settings") : null,
    sessionId: purpose === "reauth" && resolved ? resolved.sessionId : null,
    createdAt: Date.now(),
  });
  const loginHint = purpose === "reauth" && resolved ? (await getSignInIdentity(db, resolved.user.id))?.email ?? null : null;
  const url = getOidcProvider().authorizationUrl({ redirectUri: redirectUri(), state, nonce, codeChallenge, loginHint, selectAccount: purpose === "reauth" });
  return NextResponse.redirect(url);
}

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { setSessionCookie } from "@/lib/session-cookie";
import { consumeHandoff } from "@/server/auth/handoff";
import { ROUTES, safeInternalPath } from "@/server/auth/route-access";
import { createSession } from "@/server/auth/session";

/**
 * GET /auth/handoff?code=…&verifier=… — the Android app's second hop (docs/ARCHITECTURE.md §4.1c).
 *
 * The app reaches here inside its own WebView, holding a code it received over a deep link and the verifier it
 * generated before it ever opened the browser. Both are required; a code alone is worthless, which is what makes
 * the deep link safe to send through Android's intent system where another app could be listening.
 *
 * Only on success does a session come into being — created here, so it records the WebView's user agent and
 * address rather than the browser's — and it is handed over as the same HttpOnly, Secure, SameSite=Lax cookie the
 * website uses. Nothing about the cookie model changes for Android; only the route that mints it does.
 *
 * Every failure is the same redirect with the same reason. An expired code, a replayed one, one that never
 * existed and one presented with the wrong verifier are not distinguished, because telling them apart would tell
 * an interceptor which of those it is holding.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const db = getDb();
  const params = request.nextUrl.searchParams;
  const fail = (reason: string) => NextResponse.redirect(new URL(`${ROUTES.authError}?reason=${reason}`, request.url));

  const redeemed = await consumeHandoff(db, params.get("code") ?? "", params.get("verifier") ?? "");
  if (!redeemed) return fail("handoff");

  const forwarded = request.headers.get("x-forwarded-for");
  const session = await createSession(db, redeemed.userId, {
    ip: forwarded ? forwarded.split(",")[0]!.trim() : null,
    userAgent: request.headers.get("user-agent"),
  });
  await setSessionCookie(session.token, session.expiresAt);

  // `landing` was chosen by the callback from the same outcome the website would have used, and is re-checked as
  // an internal path here so a tampered row could never become an open redirect.
  const response = NextResponse.redirect(new URL(safeInternalPath(redeemed.landing, ROUTES.home), request.url));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

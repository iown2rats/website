import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { readSessionToken, setSessionCookie } from "@/lib/session-cookie";
import { emailAuthAvailable } from "@/server/auth/email-availability";
import { verifyEmailToken } from "@/server/auth/email-identity";
import { ROUTES } from "@/server/auth/route-access";
import { createSession, resolveSession } from "@/server/auth/session";

/**
 * GET /auth/verify?token=… — the link in the confirmation email (docs/ARCHITECTURE.md §4.1b).
 *
 * Verification happens here, on the server: the token is hashed, looked up, checked for purpose, expiry and prior
 * use, and consumed exactly once. Nothing in the URL beyond that token influences the result, so an account is
 * never verified because a query parameter said so. The link works in any browser — a visitor who opens it on a
 * different device is signed in to the account it belongs to, which is the point of a single-use emailed secret.
 */
export async function GET(request: NextRequest) {
  const db = getDb();
  if (!(await emailAuthAvailable(db))) return NextResponse.redirect(new URL(ROUTES.welcome, request.url));
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const result = await verifyEmailToken(token, { db });
  if (!result.ok) {
    // An expired or reused link lands on the verification screen when there is a session to resend from, and on the
    // error screen otherwise. Neither says whether the token ever existed.
    const resolved = await resolveSession(db, await readSessionToken());
    return NextResponse.redirect(new URL(resolved ? `${ROUTES.verifyEmail}?expired=1` : `${ROUTES.authError}?reason=token&provider=email`, request.url));
  }
  const resolved = await resolveSession(db, await readSessionToken());
  if (!resolved || resolved.user.id !== result.value.userId) {
    // Opened on another device, or signed out: give the confirmed account its own session.
    const forwarded = request.headers.get("x-forwarded-for");
    const session = await createSession(db, result.value.userId, { ip: forwarded ? forwarded.split(",")[0]!.trim() : null, userAgent: request.headers.get("user-agent") });
    await setSessionCookie(session.token, session.expiresAt);
  }
  // The account is confirmed, so onboarding is where it belongs; a finished account goes straight to Discover.
  const user = await db.user.findUnique({ where: { id: result.value.userId }, select: { onboardingCompletedAt: true } });
  return NextResponse.redirect(new URL(user?.onboardingCompletedAt ? ROUTES.home : ROUTES.onboarding, request.url));
}

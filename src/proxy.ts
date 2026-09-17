import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { resolveProxyAccess } from "@/server/auth/route-access";

/**
 * Optimistic route protection (docs/ARCHITECTURE.md §4.2). Only cookie presence is checked here; the real
 * session lookup and onboarding-state routing happen in the server layouts. Also sets baseline security headers.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const decision = resolveProxyAccess(hasCookie, pathname);
  const response = decision.allow ? NextResponse.next() : NextResponse.redirect(new URL(decision.redirectTo, request.url));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(self), geolocation=(), microphone=()");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico|woff2)$).*)"],
};

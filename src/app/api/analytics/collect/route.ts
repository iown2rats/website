/**
 * Analytics ingest (docs/ARCHITECTURE.md §30.3). The only endpoint that writes an analytics row.
 *
 * WHAT IT ACCEPTS is deliberately tiny: an event key, a type from a closed set, a path and a referrer. Every
 * other fact — the visitor, the session, the signed-in account, whether the caller is staff, the device, the
 * country — is derived on the server from cookies and headers. There is no field a caller can set to become
 * somebody else, and no field that reaches the database without passing through the classifier first.
 *
 * WHAT IT RETURNS is 204 and nothing else, whatever happened. A duplicate, a rate-limited caller, an untrackable
 * path and a successful write are indistinguishable from outside, because a measurement endpoint that reports on
 * its own state is an oracle: it would let anyone probe which visitor ids exist or which event keys are taken.
 *
 * Both cookies are HttpOnly, so the page that triggers this cannot read them, and a script injected into the page
 * could not steal them either. That is also why the client never sends an identifier: it does not have one.
 */
import { NextResponse } from "next/server";
import { ANALYTICS } from "@/config/product";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getAuthState } from "@/server/auth/current-user";
import { recordEvent, SESSION_COOKIE_NAME, VISITOR_COOKIE } from "@/server/analytics/ingest";
import { MAX_ANALYTICS_BODY_BYTES, parseAnalyticsBody } from "@/server/analytics/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 204 with the cookies the server decided on. The only response this route ever gives. */
function noContent(cookies: { visitorId?: string; sessionId?: string }): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  const secure = process.env.NODE_ENV === "production";
  if (cookies.visitorId) {
    response.cookies.set(VISITOR_COOKIE, cookies.visitorId, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: ANALYTICS.visitorCookieDays * 86_400,
    });
  }
  if (cookies.sessionId) {
    response.cookies.set(SESSION_COOKIE_NAME, cookies.sessionId, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      // The cookie's own life matches the idle window, but it is not what decides the session: the server
      // re-reads `lastSeenAt` on every event, so a cookie that outlives its session cannot revive it.
      maxAge: Math.floor(ANALYTICS.sessionIdleMs / 1000),
    });
  }
  return response;
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("content-type")?.includes("application/json") !== true) return noContent({});
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_ANALYTICS_BODY_BYTES) return noContent({});

    const body = parseAnalyticsBody(await request.text());
    if (!body) return noContent({});

    /*
     * Identity, resolved the same way every other protected surface resolves it. A STAFF account is recognised
     * here and its whole visit is marked excluded downstream, so operator traffic never reaches the figures.
     * Nothing about identity comes from the body.
     */
    const auth = await getAuthState();
    const isStaff = auth.kind === "staff";
    // The one door identity comes through. `getAuthState` has already verified the session against the database
    // and dropped it if the account is suspended, banned or deleted, so this is null unless somebody really is
    // signed in right now. A staff id is still recorded — their session is marked excluded, which is what keeps
    // operator traffic out of the figures, and a row that names the operator is the more auditable one.
    const userId = auth.kind === "anonymous" ? null : auth.user.id;

    const env = getEnv();
    const ownHosts: string[] = [];
    try {
      ownHosts.push(new URL(env.APP_URL).hostname);
    } catch {
      /* APP_URL is validated at boot; a bad value simply means no self-referral suppression. */
    }
    const host = request.headers.get("host");
    if (host) ownHosts.push(host.split(":")[0]!);

    const cookieHeader = request.headers.get("cookie") ?? "";
    const readCookie = (name: string): string | null => {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
      return match ? decodeURIComponent(match[1]!) : null;
    };

    const outcome = await recordEvent(
      { eventKey: body.eventKey, type: body.type, path: body.path, referrer: body.referrer },
      {
        visitorCookie: readCookie(VISITOR_COOKIE),
        sessionCookie: readCookie(SESSION_COOKIE_NAME),
        // Reduced to coarse buckets inside the classifier and never stored as given.
        userAgent: request.headers.get("user-agent"),
        // Set by the edge. There is no IP anywhere in this handler: we never read one, so we cannot store one.
        countryHeader: request.headers.get("x-vercel-ip-country"),
        ownHosts,
        userId,
        isStaff,
      },
      { db: getDb() },
    );

    if (outcome.status === "ignored") return noContent({});
    return noContent({ visitorId: outcome.visitorId, sessionId: outcome.sessionId });
  } catch {
    // A measurement endpoint must never be a source of errors for the page that called it.
    return noContent({});
  }
}

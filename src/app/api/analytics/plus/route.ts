/**
 * Plus promotion ingest (docs/ARCHITECTURE.md §12.19): "a promotion was seen" and "a promotion was tapped".
 *
 * The browser sends a UUID, the step and the surface, and nothing it sends decides who the member is — identity is
 * the verified session, and only an active MEMBER is recorded (staff, onboarding and signed-out traffic is dropped).
 * Like the site analytics endpoint it answers 204 whatever happened, so it cannot be used to probe anything, and it
 * never throws into the page that called it. With PLUS_FUNNEL_ANALYTICS off it writes nothing.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthState } from "@/server/auth/current-user";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { MAX_PLUS_BODY_BYTES, parsePlusPromptBody, PLUS_EVENTS_PER_MINUTE, recordPlusEvent } from "@/server/analytics/plus-funnel";
import { flagEnabled } from "@/server/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const done = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  try {
    if (!flagEnabled("PLUS_FUNNEL_ANALYTICS")) return done();
    if (request.headers.get("content-type")?.includes("application/json") !== true) return done();
    if (Number(request.headers.get("content-length") ?? "0") > MAX_PLUS_BODY_BYTES) return done();
    const body = parsePlusPromptBody(await request.text());
    if (!body) return done();

    const auth = await getAuthState();
    if (auth.kind !== "active" || auth.user.accountType !== "MEMBER") return done();

    const db = getDb();
    const gate = await consumeRateLimit(db, `analytics:plus:${auth.user.id}`, PLUS_EVENTS_PER_MINUTE, 60_000);
    if (!gate.allowed) return done();
    await recordPlusEvent({ event: body.event, surface: body.surface, userId: auth.user.id, eventKey: body.eventKey }, { db });
    return done();
  } catch {
    return done();
  }
}

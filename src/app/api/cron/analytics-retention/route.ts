/**
 * Scheduled analytics retention (docs/ARCHITECTURE.md §30.5).
 *
 * A retention period that is only written down is not a retention period. This route is the mechanism that makes
 * the 90 days real: it deletes raw events past the horizon, in bounded batches, and is safe to call at any time
 * from anywhere authorised — a second call straight after the first removes nothing, because the first already
 * removed it.
 *
 * `force` is not offered here and is not needed: a scheduler asking IS the schedule. The same purge is also
 * reachable from ordinary admin traffic behind a once-a-day gate (`maybePurgeExpiredAnalytics`), which matters
 * because a cron that was never configured in the hosting dashboard is a cron that never runs — and retention
 * must not depend on somebody having ticked a box.
 *
 * Authorization is the same shared secret the other cron routes use. With CRON_SECRET unset it refuses
 * everything: an endpoint that deletes rows must never be open, and failing closed costs only punctuality.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { purgeExpiredAnalytics } from "@/server/analytics/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(offered);
  const b = Buffer.from(secret);
  // Compare lengths first: timingSafeEqual throws on a mismatch, and the length is not the secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    // No detail, and the same answer whether the secret is wrong or simply not configured.
    return new NextResponse("Not found", { status: 404 });
  }
  const result = await purgeExpiredAnalytics();
  return NextResponse.json(result);
}

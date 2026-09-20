/**
 * Scheduled entry point for the unread-message email sweep (docs/ARCHITECTURE.md §12.13).
 *
 * The sweep also runs off ordinary traffic, so this route is about TIMELINESS, not correctness: on a quiet night
 * nobody sends a message, so nothing drives the sweep, and mail for a message left unread at 3am waits for the
 * first request of the morning. A scheduler calling this closes that gap.
 *
 * Authorization is a shared secret in the standard `Authorization: Bearer` header, which is what Vercel Cron sends
 * and what any other scheduler can send. With CRON_SECRET unset the route refuses everything: an endpoint that
 * triggers outbound email must never be open, and failing closed costs only punctuality.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { sweepUnreadMessageEmails } from "@/server/notifications/message-email";

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
  // `force`: a scheduler asking is the whole point, so it is not subject to the once-a-minute traffic gate.
  const result = await sweepUnreadMessageEmails({ force: true });
  return NextResponse.json(result);
}

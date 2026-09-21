/**
 * Scheduled entry point for the subscription lifecycle sweep (docs/ARCHITECTURE.md §12.12).
 *
 * This route does NOT enforce Plus. It never could: `getEntitlements` and `activePlusSql` both require
 * `currentPeriodEnd > now`, so a lapsed period stops granting Plus at the instant it ends whether or not anything
 * has run. That is the design, and it is why this sweep never being called is a bookkeeping problem rather than a
 * paid-features leak.
 *
 * What it does is reconcile the record with the clock, and talk to the customer:
 *   - `notifyExpiringSubscriptions` warns, once, three days before a customer's LAST paid period ends
 *   - `markExpiredSubscriptions` moves lapsed rows to EXPIRED and tells the customer their Plus has ended
 *
 * Both are idempotent, so calling this twice a day, or twice a minute, changes nothing: an EXPIRED row is no longer
 * in the granting statuses the sweep looks for, and each notification is keyed by its subscription id.
 *
 * Authorization is the same shared secret as the message-email sweep — `Authorization: Bearer`, what Vercel Cron
 * sends. With CRON_SECRET unset the route refuses everything. This endpoint writes to customer records and sends
 * notifications, so it fails closed; the cost of that is a day of stale bookkeeping, never a wrong entitlement.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { markExpiredSubscriptions, notifyExpiringSubscriptions } from "@/server/billing/expiry";

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
  const db = getDb();
  const now = new Date();
  // Warn first. A customer whose period ends during this very run should get "ending soon" only if it has not
  // already ended; running the warning after the sweep would send it about a subscription already marked EXPIRED.
  const warned = await notifyExpiringSubscriptions(db, now);
  const { expired, notified } = await markExpiredSubscriptions(db, now);
  return NextResponse.json({ ranAt: now.toISOString(), warned, expired, notified });
}

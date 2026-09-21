/**
 * Both scheduled endpoints are protected by the same shared secret, and both must FAIL CLOSED.
 *
 * `/api/cron/subscriptions` writes to customer records and sends notifications; `/api/cron/message-emails` sends
 * outbound mail. Neither is something a stranger should be able to trigger, and neither has any other guard — no
 * session, no CSRF, no origin check — so the secret is the whole of the door.
 *
 * The route files own the check but cannot be imported here without a request context, so this suite pins the
 * contract they both implement: the exact header shape, a constant-time comparison, and refusal when the secret is
 * missing. The source is asserted directly, because the failure mode being guarded against is someone "tidying"
 * the comparison into `===` or adding an `if (!secret) return true` convenience.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ROUTES = ["src/app/api/cron/subscriptions/route.ts", "src/app/api/cron/message-emails/route.ts"];

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe.each(ROUTES)("%s", (rel) => {
  const src = source(rel);

  it("refuses everything when CRON_SECRET is not configured", () => {
    // An unset secret must mean "closed", never "open to anyone".
    expect(src).toMatch(/if\s*\(!secret\)\s*return false/);
  });

  it("reads the secret from the environment and never from the request", () => {
    expect(src).toMatch(/getEnv\(\)\.CRON_SECRET/);
    // No query-string or body fallback: a secret in a URL ends up in logs and referrers.
    expect(src).not.toMatch(/searchParams|nextUrl\.query|request\.json\(\)/);
  });

  it("takes the secret from the standard Bearer header, which is what Vercel Cron sends", () => {
    expect(src).toMatch(/headers\.get\("authorization"\)/);
    expect(src).toMatch(/startsWith\("Bearer "\)/);
  });

  it("compares in constant time, after a length check, because timingSafeEqual throws on a mismatch", () => {
    expect(src).toMatch(/timingSafeEqual/);
    expect(src).toMatch(/a\.length === b\.length && timingSafeEqual\(a, b\)/);
  });

  it("answers an unauthorized caller with a bare 404 that reveals nothing", () => {
    expect(src).toMatch(/status:\s*404/);
    expect(src).not.toMatch(/401|Unauthorized|Forbidden/);
  });

  it("is dynamic, so a scheduled hit is never served from a cache", () => {
    expect(src).toMatch(/export const dynamic = "force-dynamic"/);
  });
});

describe("the Vercel schedule", () => {
  const vercel = JSON.parse(source("vercel.json")) as { crons?: { path: string; schedule: string }[] };

  it("schedules the subscription sweep daily", () => {
    const cron = vercel.crons?.find((c) => c.path === "/api/cron/subscriptions");
    expect(cron, "no cron entry for the subscription sweep").toBeDefined();
    // Five fields, and a fixed time every day rather than a step: one run a day is enough because the sweep is
    // bookkeeping — entitlement already ends on the clock — and a fixed minute keeps it off the hour's stampede.
    expect(cron!.schedule.split(/\s+/)).toHaveLength(5);
    expect(cron!.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it("points every scheduled path at a route that exists", () => {
    for (const cron of vercel.crons ?? []) {
      expect(() => source(`src/app${cron.path}/route.ts`), cron.path).not.toThrow();
    }
  });
});

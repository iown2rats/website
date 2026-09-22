import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ANALYTICS } from "@/config/product";
import { hasPermission, ROLE_PERMISSIONS } from "@/server/admin/permissions";
import { purgeExpiredAnalytics, maybePurgeExpiredAnalytics, recordEvent, type IngestContext } from "@/server/analytics/ingest";
import { getAnalyticsReport } from "@/server/analytics/report";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createStaff, createUser, minutes } from "../helpers/factory";

/*
 * Website analytics (docs/ARCHITECTURE.md §30).
 *
 * Two rules are on trial here and everything else is detail.
 *
 * The first is that a duplicate cannot become a second row. The client is expected to retry, to double-invoke its
 * effects and to reconnect; none of that may inflate a number, and the guarantee is a UNIQUE constraint rather
 * than a convention, so these tests hammer the same key from several directions at once.
 *
 * The second is that the tables cannot hold what they were promised not to hold. Those tests are written as
 * assertions over the STORED ROW — not over the classifier, which is unit-tested separately — because the promise
 * made in the Privacy Policy is about what is in the database, not about what some function returned.
 */

const db = testDb();
const T0 = new Date("2026-09-22T10:00:00Z");

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Mobile Safari/537.36";

/** A plain anonymous visitor arriving cold. Every field the server would read from a real request. */
function context(overrides: Partial<IngestContext> = {}): IngestContext {
  return {
    visitorCookie: null,
    sessionCookie: null,
    userAgent: ANDROID_UA,
    countryHeader: "MV",
    ownHosts: ["www.mellocrush.com"],
    userId: null,
    isStaff: false,
    ...overrides,
  };
}

/** Records a page view exactly as the route would, and hands back whatever the server decided. */
function tryView(path: string, ctx: IngestContext, now: Date, opts: { eventKey?: string; referrer?: string | null } = {}) {
  return recordEvent({ eventKey: opts.eventKey ?? randomUUID(), type: "PAGE_VIEW", path, referrer: opts.referrer ?? null }, ctx, { db, now });
}

/**
 * The same, for the overwhelming majority of tests that expect the view to be accepted. Throwing on "ignored"
 * keeps the cookie fields non-optional at the call site, so a test can never quietly assert against undefined.
 */
async function view(path: string, ctx: IngestContext, now: Date, opts: { eventKey?: string; referrer?: string | null } = {}) {
  const outcome = await tryView(path, ctx, now, opts);
  if (outcome.status === "ignored") throw new Error(`expected the view to be recorded, but it was ignored: ${outcome.reason}`);
  return outcome;
}

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

// ───────────────────────── Deduplication ─────────────────────────

describe("duplicate events cannot become duplicate rows", () => {
  it("records one row however many times the same event key arrives", async () => {
    const key = randomUUID();
    const first = await view("/community", context(), T0, { eventKey: key });
    expect(first.status).toBe("recorded");

    const ctx = context({ visitorCookie: first.visitorId, sessionCookie: first.sessionId });
    for (let i = 0; i < 5; i += 1) {
      const again = await view("/community", ctx, at(T0, i * 100), { eventKey: key });
      expect(again.status).toBe("duplicate");
    }

    expect(await db.analyticsEvent.count()).toBe(1);
  });

  it("keeps exactly one row when the same key races itself", async () => {
    const key = randomUUID();
    const seed = await view("/", context(), T0);
    const ctx = context({ visitorCookie: seed.visitorId, sessionCookie: seed.sessionId });

    // A retry storm: five concurrent requests carrying one key, which is what a flaky connection produces.
    await Promise.all(Array.from({ length: 5 }, () => view("/community", ctx, T0, { eventKey: key })));

    expect(await db.analyticsEvent.count({ where: { eventKey: key } })).toBe(1);
  });

  it("counts a genuine second navigation, because a new key is a new view", async () => {
    const first = await view("/", context(), T0);
    const ctx = context({ visitorCookie: first.visitorId, sessionCookie: first.sessionId });
    await view("/community", ctx, at(T0, 1_000));
    // A refresh: same path, new key, and it is a real second view of that page.
    await view("/community", ctx, at(T0, 2_000));

    expect(await db.analyticsEvent.count()).toBe(3);
    expect(await db.visitorSession.count()).toBe(1);
  });
});

// ───────────────────────── Sessions ─────────────────────────

describe("visits", () => {
  it("shares one visit across tabs while it is active", async () => {
    const first = await view("/", context(), T0);
    const ctx = context({ visitorCookie: first.visitorId, sessionCookie: first.sessionId });

    // A second tab sends its own event with the same cookies, as a browser would.
    const secondTab = await view("/community", ctx, at(T0, minutes(1)));
    expect(secondTab.sessionId).toBe(first.sessionId);
    expect(secondTab.startedSession).toBe(false);
    expect(await db.visitorSession.count()).toBe(1);
  });

  it("keeps the visit alive while activity continues inside the idle window", async () => {
    const first = await view("/", context(), T0);
    const ctx = context({ visitorCookie: first.visitorId, sessionCookie: first.sessionId });

    // Just inside 30 minutes, repeatedly: a long read is still one visit.
    let last = first;
    for (const offset of [minutes(20), minutes(45), minutes(70)]) {
      last = await view("/community", ctx, at(T0, offset));
      expect(last.sessionId).toBe(first.sessionId);
    }
    expect(await db.visitorSession.count()).toBe(1);
  });

  it("starts a new visit after 30 minutes of silence, keeping the same visitor", async () => {
    const first = await view("/", context(), T0);
    const ctx = context({ visitorCookie: first.visitorId, sessionCookie: first.sessionId });

    const after = await view("/community", ctx, at(T0, ANALYTICS.sessionIdleMs + minutes(1)));
    expect(after.startedSession).toBe(true);
    expect(after.sessionId).not.toBe(first.sessionId);
    // The person is the same; only the visit is new.
    expect(after.visitorId).toBe(first.visitorId);

    expect(await db.visitorSession.count()).toBe(2);
    expect(await db.visitor.count()).toBe(1);
    expect((await db.visitor.findUniqueOrThrow({ where: { id: first.visitorId } })).sessionCount).toBe(2);
  });

  it("does not resurrect an expired visit just because the cookie survived", async () => {
    const first = await view("/", context(), T0);
    // Exactly at the boundary the visit is already over: liveness is read from the row, not from the cookie.
    const exactly = await view("/", context({ visitorCookie: first.visitorId, sessionCookie: first.sessionId }), at(T0, ANALYTICS.sessionIdleMs + 1));
    expect(exactly.startedSession).toBe(true);
  });

  it("marks the second visit as returning", async () => {
    const first = await view("/", context(), T0);
    const later = await view("/", context({ visitorCookie: first.visitorId }), at(T0, ANALYTICS.sessionIdleMs + minutes(5)));

    const sessions = await db.visitorSession.findMany({ orderBy: { startedAt: "asc" }, select: { isReturning: true } });
    expect(sessions.map((s) => s.isReturning)).toEqual([false, true]);
    expect(later.visitorId).toBe(first.visitorId);
  });

  it("refuses a session cookie that belongs to a different visitor rather than adopting it", async () => {
    const a = await view("/", context(), T0);
    const b = await view("/", context(), T0);
    expect(a.visitorId).not.toBe(b.visitorId);

    // A crafted or copied pairing: B's visitor id with A's session id. Splicing them would merge two people.
    const spliced = await view("/community", context({ visitorCookie: b.visitorId, sessionCookie: a.sessionId }), at(T0, minutes(1)));
    expect(spliced.sessionId).not.toBe(a.sessionId);
    expect(spliced.visitorId).toBe(b.visitorId);
  });

  it("mints a fresh visitor when the cookie names one that does not exist", async () => {
    const forged = await view("/", context({ visitorCookie: "totallymadeupvisitor" }), T0);
    expect(forged.visitorId).not.toBe("totallymadeupvisitor");
    expect(await db.visitor.count()).toBe(1);
  });
});

// ───────────────────────── Abuse ceilings ─────────────────────────

describe("rate limiting", () => {
  it("caps a known visitor's events per minute", async () => {
    const first = await view("/", context(), T0);
    const ctx = context({ visitorCookie: first.visitorId, sessionCookie: first.sessionId });
    for (let i = 0; i < ANALYTICS.eventsPerMinute; i += 1) await tryView("/community", ctx, T0);

    const over = await tryView("/community", ctx, T0);
    expect(over).toEqual({ status: "ignored", reason: "rate-limited" });
  });

  it("caps the creation of brand-new visitors, so a cookie-less flood cannot inflate the tables", async () => {
    // The regression this pins: the limit used to be keyed on the visitor, and was taken AFTER the row was
    // created — so a caller sending no cookie got a fresh key every time, never tripped the limit, and wrote one
    // Visitor row per request. A caller with no cookie cannot be identified without reading an address, and
    // reading one is exactly what this feature refuses to do, so the cap is global and taken first.
    for (let i = 0; i < ANALYTICS.newVisitorsPerMinute; i += 1) await tryView("/", context(), T0);
    expect(await db.visitor.count()).toBe(ANALYTICS.newVisitorsPerMinute);

    const over = await tryView("/", context(), T0);
    expect(over).toEqual({ status: "ignored", reason: "rate-limited" });
    // The important assertion is this one: nothing was written for the refused caller.
    expect(await db.visitor.count()).toBe(ANALYTICS.newVisitorsPerMinute);
  });

  it("lets a known visitor through while new-visitor creation is exhausted", async () => {
    const known = await view("/", context(), T0);
    const ctx = context({ visitorCookie: known.visitorId, sessionCookie: known.sessionId });
    for (let i = 0; i < ANALYTICS.newVisitorsPerMinute; i += 1) await tryView("/", context(), T0);

    // Real visitors already holding a cookie are on their own budget and are not collateral damage.
    expect((await tryView("/community", ctx, T0)).status).toBe("recorded");
  });
});

// ───────────────────────── Identity ─────────────────────────

describe("identity", () => {
  it("attaches a member only from a real server session, and never guesses", async () => {
    const member = await createUser(db, { now: T0, name: "Aminath" });
    const anon = await view("/", context(), T0);
    expect((await db.visitorSession.findUniqueOrThrow({ where: { id: anon.sessionId } })).userId).toBeNull();

    // They sign in mid-visit: the same visit gains the identity the server resolved.
    const ctx = context({ visitorCookie: anon.visitorId, sessionCookie: anon.sessionId, userId: member.userId });
    const signedIn = await view("/discover", ctx, at(T0, minutes(2)));
    expect(signedIn.sessionId).toBe(anon.sessionId);
    expect((await db.visitorSession.findUniqueOrThrow({ where: { id: anon.sessionId } })).userId).toBe(member.userId);
  });

  it("leaves anonymous visits anonymous in the report", async () => {
    await view("/", context(), T0);
    const report = await getAnalyticsReport("24h", { db, now: at(T0, minutes(1)) });
    expect(report.recent).toHaveLength(1);
    expect(report.recent[0]!.name).toBeNull();
    expect(report.recent[0]!.userId).toBeNull();
  });
});

// ───────────────────────── Staff exclusion ─────────────────────────

describe("staff traffic", () => {
  it("is excluded from every figure on the screen", async () => {
    const staff = await createStaff(db, { now: T0 });
    await view("/", context({ userId: staff.userId, isStaff: true }), T0);
    await view("/", context(), at(T0, minutes(1)));

    const report = await getAnalyticsReport("24h", { db, now: at(T0, minutes(2)) });
    expect(report.window.visitors).toBe(1);
    expect(report.window.sessions).toBe(1);
    expect(report.today.visitors).toBe(1);
    expect(report.live.visitors).toBe(1);
    expect(report.recent).toHaveLength(1);
    // The row still exists — it is excluded, not discarded, so the visit remains auditable.
    expect(await db.visitorSession.count()).toBe(2);
    expect(await db.visitorSession.count({ where: { excluded: true } })).toBe(1);
  });

  it("excludes the whole visit retroactively when an operator signs in part-way through", async () => {
    const staff = await createStaff(db, { now: T0 });
    const anon = await view("/", context(), T0);
    expect((await db.visitorSession.findUniqueOrThrow({ where: { id: anon.sessionId } })).excluded).toBe(false);

    const ctx = context({ visitorCookie: anon.visitorId, sessionCookie: anon.sessionId, userId: staff.userId, isStaff: true });
    await view("/legal/privacy", ctx, at(T0, minutes(1)));

    // The pages they looked at before signing in go with them, so an operator never counts as a visitor.
    expect((await db.visitorSession.findUniqueOrThrow({ where: { id: anon.sessionId } })).excluded).toBe(true);
    const report = await getAnalyticsReport("24h", { db, now: at(T0, minutes(2)) });
    expect(report.window.pageViews).toBe(0);
    expect(report.window.visitors).toBe(0);
  });

  it("never records the admin portal as a page", async () => {
    const ignored = await tryView("/admin/analytics", context(), T0);
    expect(ignored.status).toBe("ignored");
    expect(await db.analyticsEvent.count()).toBe(0);
  });
});

// ───────────────────────── Permission ─────────────────────────

describe("analytics permission", () => {
  it("is held by ADMIN and withheld from MODERATOR", () => {
    expect(hasPermission("ADMIN", "analytics.view")).toBe(true);
    expect(hasPermission("MODERATOR", "analytics.view")).toBe(false);
    expect(ROLE_PERMISSIONS.MODERATOR).not.toContain("analytics.view");
  });
});

// ───────────────────────── Privacy ─────────────────────────

describe("what the tables are allowed to hold", () => {
  it("has no column that could hold an IP address or a User-Agent", async () => {
    const columns = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('Visitor', 'VisitorSession', 'AnalyticsEvent')
    `;
    const names = columns.map((c) => c.column_name.toLowerCase());
    // The guarantee is structural: a column that does not exist cannot be filled in later by accident.
    for (const forbidden of ["ip", "ipaddress", "ip_address", "useragent", "user_agent", "fingerprint", "latitude", "longitude", "geo"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("stores no query string, no fragment and no raw identifier from a visited URL", async () => {
    const first = await view("/community?q=aminath&token=secret123#top", context(), T0);
    const ctx = context({ visitorCookie: first.visitorId, sessionCookie: first.sessionId });
    await view("/chats/xpjkjp4162uhnfs6ot8c7fp9", ctx, at(T0, 1_000));

    const paths = (await db.analyticsEvent.findMany({ select: { path: true } })).map((r) => r.path);
    expect(paths).toContain("/community");
    expect(paths).toContain("/chats/:id");
    const serialised = JSON.stringify(paths);
    expect(serialised).not.toContain("secret123");
    expect(serialised).not.toContain("aminath");
    expect(serialised).not.toContain("xpjkjp4162uhnfs6ot8c7fp9");
  });

  it("stores the referring host and never the referring URL", async () => {
    await view("/", context(), T0, { referrer: "https://www.google.com/search?q=someone%27s+name+maldives" });
    const session = await db.visitorSession.findFirstOrThrow();
    expect(session.source).toBe("GOOGLE");
    expect(session.referrerHost).toBe("google.com");
    expect(JSON.stringify(session)).not.toContain("search");
    expect(JSON.stringify(session)).not.toContain("name");
  });

  it("falls back to DIRECT when the browser suppressed the referrer", async () => {
    await view("/", context(), T0, { referrer: null });
    await view("/", context(), at(T0, minutes(1)), { referrer: "android-app://com.example" });
    const sessions = await db.visitorSession.findMany({ select: { source: true, referrerHost: true } });
    expect(sessions.every((s) => s.source === "DIRECT" && s.referrerHost === null)).toBe(true);
  });

  it("stores the whole User-Agent as three coarse buckets and nothing else", async () => {
    await view("/", context(), T0);
    const session = await db.visitorSession.findFirstOrThrow();
    expect({ device: session.device, browser: session.browser, os: session.os }).toEqual({ device: "MOBILE", browser: "Chrome", os: "Android" });
    // No version, no model, no build — the identifying parts of the string are gone for good.
    const serialised = JSON.stringify(session);
    expect(serialised).not.toContain("SM-S911B");
    expect(serialised).not.toContain("131.0.6778.86");
    expect(serialised).not.toContain("AppleWebKit");
  });

  it("stores a country only when it is a real two-letter code", async () => {
    await view("/", context({ countryHeader: "mv" }), T0);
    await view("/", context({ countryHeader: "XX" }), at(T0, minutes(1)));
    await view("/", context({ countryHeader: "4.175,73.509" }), at(T0, minutes(2)));
    const countries = (await db.visitorSession.findMany({ orderBy: { startedAt: "asc" }, select: { country: true } })).map((s) => s.country);
    expect(countries).toEqual(["MV", null, null]);
  });
});

// ───────────────────────── Retention ─────────────────────────

describe("90-day retention", () => {
  /** Plants one visit whose events are `ageDays` old. */
  async function plant(ageDays: number, now: Date) {
    const when = new Date(now.getTime() - ageDays * 86_400_000);
    const outcome = await view("/", context(), when);
    return outcome;
  }

  it("deletes events past the horizon and keeps everything inside it", async () => {
    const now = new Date("2026-12-31T10:00:00Z");
    await plant(120, now);
    await plant(91, now);
    const recent = await plant(10, now);
    expect(await db.analyticsEvent.count()).toBe(3);

    const result = await purgeExpiredAnalytics({ db, now });
    expect(result.events).toBe(2);
    const survivors = await db.analyticsEvent.findMany({ select: { sessionId: true } });
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.sessionId).toBe(recent.sessionId);
  });

  it("is idempotent: running it again removes nothing", async () => {
    const now = new Date("2026-12-31T10:00:00Z");
    await plant(120, now);
    await plant(5, now);

    const first = await purgeExpiredAnalytics({ db, now });
    const second = await purgeExpiredAnalytics({ db, now });
    expect(first.events).toBe(1);
    expect(second).toEqual({ events: 0, sessions: 0, visitors: 0, more: false });
    expect(await db.analyticsEvent.count()).toBe(1);
  });

  it("sweeps up the sessions and visitors the deleted events leave behind", async () => {
    const now = new Date("2026-12-31T10:00:00Z");
    await plant(120, now);
    await purgeExpiredAnalytics({ db, now });
    // Nothing points at them and they are past the horizon themselves: a bare id answers no question.
    expect(await db.visitorSession.count()).toBe(0);
    expect(await db.visitor.count()).toBe(0);
  });

  it("never touches a visit that is still in progress", async () => {
    const now = new Date("2026-12-31T10:00:00Z");
    await plant(120, now);
    const live = await view("/", context(), now);
    await purgeExpiredAnalytics({ db, now });

    expect(await db.visitorSession.count({ where: { id: live.sessionId } })).toBe(1);
    expect(await db.visitor.count({ where: { id: live.visitorId } })).toBe(1);
  });

  it("runs at most once a day when kicked from ordinary admin traffic", async () => {
    const now = new Date("2026-12-31T10:00:00Z");
    await plant(120, now);

    expect(await maybePurgeExpiredAnalytics({ db, now })).not.toBeNull();
    // The safety net exists so retention holds even where no scheduler was ever configured — but it must not
    // re-run on every page load.
    expect(await maybePurgeExpiredAnalytics({ db, now: at(now, minutes(5)) })).toBeNull();
    expect(await maybePurgeExpiredAnalytics({ db, now: at(now, ANALYTICS.purgeEveryMs + minutes(1)) })).not.toBeNull();
  });
});

// ───────────────────────── The report ─────────────────────────

describe("the report", () => {
  it("counts visitors, visits, page views and conversion from canonical rows", async () => {
    const one = await view("/", context(), T0);
    await view("/community", context({ visitorCookie: one.visitorId, sessionCookie: one.sessionId }), at(T0, minutes(1)));
    await view("/", context(), at(T0, minutes(2)));
    await createUser(db, { now: at(T0, minutes(3)) });

    const report = await getAnalyticsReport("24h", { db, now: at(T0, minutes(5)) });
    expect(report.window.visitors).toBe(2);
    expect(report.window.sessions).toBe(2);
    expect(report.window.pageViews).toBe(3);
    expect(report.window.signups).toBe(1);
    expect(report.window.conversionPct).toBe(50);
    expect(report.window.anonymousSessions).toBe(2);
    expect(report.window.signedInSessions).toBe(0);
  });

  it("reports a live visitor only inside the five-minute window", async () => {
    await view("/", context(), T0);
    expect((await getAnalyticsReport("24h", { db, now: at(T0, minutes(2)) })).live.visitors).toBe(1);
    expect((await getAnalyticsReport("24h", { db, now: at(T0, minutes(6)) })).live.visitors).toBe(0);
  });

  it("returns every bucket in the window, including the empty ones", async () => {
    await view("/", context(), T0);
    const report = await getAnalyticsReport("24h", { db, now: at(T0, 6 * 3_600_000) });
    expect(report.series.length).toBeGreaterThan(20);
    expect(report.series.some((b) => b.pageViews === 0)).toBe(true);
    expect(report.series.reduce((sum, b) => sum + b.pageViews, 0)).toBe(1);
  });

  it("never returns an identifier for an anonymous visit beyond the opaque visit reference", async () => {
    await view("/community?secret=abc", context(), T0);
    const report = await getAnalyticsReport("24h", { db, now: at(T0, minutes(1)) });
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain("secret");
    expect(serialised).not.toContain(ANDROID_UA);
    expect(serialised).not.toContain("SM-S911B");
  });
});

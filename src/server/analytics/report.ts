/**
 * The Analytics read model (docs/ARCHITECTURE.md §30.6).
 *
 * Every figure is counted from rows at request time, exactly as the existing Dashboard does: no stored counters,
 * so nothing can drift out of step with the events that produced it.
 *
 * TWO EXCLUSIONS APPLY TO EVERY QUERY HERE and both live in one fragment, `INCLUDED`, so a new panel cannot
 * forget them: sessions marked `excluded` (staff) are never counted, and events are always read through their
 * session so the exclusion follows them. An operator looking at this screen is looking at other people's traffic,
 * never their own.
 *
 * Nothing in this module returns an IP, a User-Agent, a full referring URL or a raw path with a query string,
 * because no such value exists in the tables it reads.
 */
import { Prisma } from "@/generated/prisma/client";
import { ANALYTICS } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { startOfMaldivesDay } from "@/server/admin/metrics";

export type AnalyticsRange = "24h" | "7d" | "30d";

export const RANGES: Record<AnalyticsRange, { label: string; ms: number; buckets: number; bucketMs: number }> = {
  "24h": { label: "24 hours", ms: 24 * 3_600_000, buckets: 24, bucketMs: 3_600_000 },
  "7d": { label: "7 days", ms: 7 * 86_400_000, buckets: 7, bucketMs: 86_400_000 },
  "30d": { label: "30 days", ms: 30 * 86_400_000, buckets: 30, bucketMs: 86_400_000 },
};

export function parseRange(value: string | undefined): AnalyticsRange {
  return value === "7d" || value === "30d" || value === "24h" ? value : "24h";
}

export interface Bucket {
  /** ISO start of the bucket. The client renders it in Maldives time; the server never guesses a timezone. */
  startsAt: string;
  visitors: number;
  pageViews: number;
}

export interface Breakdown {
  key: string;
  count: number;
}

export interface RecentVisit {
  sessionId: string;
  /** The member's display name when the visit belongs to a signed-in account; null when it does not. */
  name: string | null;
  userId: string | null;
  startedAt: string;
  lastSeenAt: string;
  device: string;
  browser: string | null;
  os: string | null;
  country: string | null;
  source: string;
  landingPath: string | null;
  pageViews: number;
  isReturning: boolean;
  live: boolean;
}

export interface AnalyticsReport {
  range: AnalyticsRange;
  generatedAt: string;
  live: { visitors: number; members: number };
  today: { visitors: number; sessions: number; pageViews: number; signups: number; conversionPct: number };
  window: {
    visitors: number;
    sessions: number;
    pageViews: number;
    signups: number;
    conversionPct: number;
    newVisitors: number;
    returningVisitors: number;
    signedInSessions: number;
    anonymousSessions: number;
  };
  series: Bucket[];
  sources: Breakdown[];
  pages: Breakdown[];
  devices: Breakdown[];
  browsers: Breakdown[];
  operatingSystems: Breakdown[];
  countries: Breakdown[];
  recent: RecentVisit[];
  retentionDays: number;
}

/** Staff traffic is not visitor traffic. Applied to every query in this file, without exception. */
const INCLUDED = Prisma.sql`vs."excluded" = false`;

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

const n = (value: unknown): number => Number(value ?? 0);

export async function getAnalyticsReport(range: AnalyticsRange, options: { db?: Db; now?: Date } = {}): Promise<AnalyticsReport> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const spec = RANGES[range];
  const since = new Date(now.getTime() - spec.ms);
  const dayStart = startOfMaldivesDay(now);
  const liveSince = new Date(now.getTime() - ANALYTICS.liveWithinMs);

  const [live, today, windowTotals, series, sources, pages, devices, browsers, operatingSystems, countries, recent, signupsToday, signupsWindow] =
    await Promise.all([
      db.$queryRaw<{ visitors: bigint; members: bigint }[]>`
        SELECT count(DISTINCT vs."visitorId")::bigint AS visitors,
               count(DISTINCT vs."userId")::bigint    AS members
        FROM "VisitorSession" vs
        WHERE ${INCLUDED} AND vs."lastSeenAt" >= ${liveSince}
      `,
      db.$queryRaw<{ visitors: bigint; sessions: bigint; views: bigint }[]>`
        SELECT count(DISTINCT vs."visitorId")::bigint AS visitors,
               count(DISTINCT vs."id")::bigint        AS sessions,
               count(ae."id")::bigint                 AS views
        FROM "VisitorSession" vs
        LEFT JOIN "AnalyticsEvent" ae ON ae."sessionId" = vs."id" AND ae."type" = 'PAGE_VIEW' AND ae."createdAt" >= ${dayStart}
        WHERE ${INCLUDED} AND vs."startedAt" >= ${dayStart}
      `,
      db.$queryRaw<{ visitors: bigint; sessions: bigint; views: bigint; fresh: bigint; returning: bigint; signedin: bigint }[]>`
        SELECT count(DISTINCT vs."visitorId")::bigint                                        AS visitors,
               count(DISTINCT vs."id")::bigint                                               AS sessions,
               count(ae."id")::bigint                                                        AS views,
               count(DISTINCT vs."visitorId") FILTER (WHERE vs."isReturning" = false)::bigint AS fresh,
               count(DISTINCT vs."visitorId") FILTER (WHERE vs."isReturning" = true)::bigint  AS returning,
               count(DISTINCT vs."id") FILTER (WHERE vs."userId" IS NOT NULL)::bigint         AS signedin
        FROM "VisitorSession" vs
        LEFT JOIN "AnalyticsEvent" ae ON ae."sessionId" = vs."id" AND ae."type" = 'PAGE_VIEW' AND ae."createdAt" >= ${since}
        WHERE ${INCLUDED} AND vs."startedAt" >= ${since}
      `,
      db.$queryRaw<{ bucket: Date; visitors: bigint; views: bigint }[]>`
        SELECT to_timestamp(floor(extract(epoch FROM ae."createdAt") / ${spec.bucketMs / 1000}) * ${spec.bucketMs / 1000}) AS bucket,
               count(DISTINCT ae."visitorId")::bigint AS visitors,
               count(*)::bigint                       AS views
        FROM "AnalyticsEvent" ae
        JOIN "VisitorSession" vs ON vs."id" = ae."sessionId"
        WHERE ${INCLUDED} AND ae."type" = 'PAGE_VIEW' AND ae."createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1
      `,
      db.$queryRaw<{ key: string; count: bigint }[]>`
        SELECT vs."source"::text AS key, count(DISTINCT vs."id")::bigint AS count
        FROM "VisitorSession" vs WHERE ${INCLUDED} AND vs."startedAt" >= ${since}
        GROUP BY 1 ORDER BY count DESC, key LIMIT ${ANALYTICS.listSize}
      `,
      db.$queryRaw<{ key: string; count: bigint }[]>`
        SELECT ae."path" AS key, count(*)::bigint AS count
        FROM "AnalyticsEvent" ae JOIN "VisitorSession" vs ON vs."id" = ae."sessionId"
        WHERE ${INCLUDED} AND ae."type" = 'PAGE_VIEW' AND ae."path" IS NOT NULL AND ae."createdAt" >= ${since}
        GROUP BY 1 ORDER BY count DESC, key LIMIT ${ANALYTICS.listSize}
      `,
      db.$queryRaw<{ key: string; count: bigint }[]>`
        SELECT vs."device"::text AS key, count(DISTINCT vs."id")::bigint AS count
        FROM "VisitorSession" vs WHERE ${INCLUDED} AND vs."startedAt" >= ${since}
        GROUP BY 1 ORDER BY count DESC, key
      `,
      db.$queryRaw<{ key: string; count: bigint }[]>`
        SELECT coalesce(vs."browser", 'Unknown') AS key, count(DISTINCT vs."id")::bigint AS count
        FROM "VisitorSession" vs WHERE ${INCLUDED} AND vs."startedAt" >= ${since}
        GROUP BY 1 ORDER BY count DESC, key LIMIT ${ANALYTICS.listSize}
      `,
      db.$queryRaw<{ key: string; count: bigint }[]>`
        SELECT coalesce(vs."os", 'Unknown') AS key, count(DISTINCT vs."id")::bigint AS count
        FROM "VisitorSession" vs WHERE ${INCLUDED} AND vs."startedAt" >= ${since}
        GROUP BY 1 ORDER BY count DESC, key LIMIT ${ANALYTICS.listSize}
      `,
      db.$queryRaw<{ key: string; count: bigint }[]>`
        SELECT coalesce(vs."country", 'Unknown') AS key, count(DISTINCT vs."id")::bigint AS count
        FROM "VisitorSession" vs WHERE ${INCLUDED} AND vs."startedAt" >= ${since}
        GROUP BY 1 ORDER BY count DESC, key LIMIT ${ANALYTICS.listSize}
      `,
      db.$queryRaw<
        {
          id: string;
          userId: string | null;
          name: string | null;
          startedAt: Date;
          lastSeenAt: Date;
          device: string;
          browser: string | null;
          os: string | null;
          country: string | null;
          source: string;
          landingPath: string | null;
          isReturning: boolean;
          views: bigint;
        }[]
      >`
        SELECT vs."id", vs."userId", p."displayName" AS name, vs."startedAt", vs."lastSeenAt",
               vs."device"::text AS device, vs."browser", vs."os", vs."country", vs."source"::text AS source,
               vs."landingPath", vs."isReturning",
               (SELECT count(*) FROM "AnalyticsEvent" ae WHERE ae."sessionId" = vs."id" AND ae."type" = 'PAGE_VIEW')::bigint AS views
        FROM "VisitorSession" vs
        LEFT JOIN "Profile" p ON p."userId" = vs."userId"
        WHERE ${INCLUDED}
        ORDER BY vs."lastSeenAt" DESC
        LIMIT ${ANALYTICS.listSize}
      `,
      db.user.count({ where: { accountType: "MEMBER", createdAt: { gte: dayStart } } }),
      db.user.count({ where: { accountType: "MEMBER", createdAt: { gte: since } } }),
    ]);

  const todayRow = today[0];
  const windowRow = windowTotals[0];
  const todayVisitors = n(todayRow?.visitors);
  const windowVisitors = n(windowRow?.visitors);
  const windowSessions = n(windowRow?.sessions);

  return {
    range,
    generatedAt: now.toISOString(),
    live: { visitors: n(live[0]?.visitors), members: n(live[0]?.members) },
    today: {
      visitors: todayVisitors,
      sessions: n(todayRow?.sessions),
      pageViews: n(todayRow?.views),
      signups: signupsToday,
      conversionPct: pct(signupsToday, todayVisitors),
    },
    window: {
      visitors: windowVisitors,
      sessions: windowSessions,
      pageViews: n(windowRow?.views),
      signups: signupsWindow,
      conversionPct: pct(signupsWindow, windowVisitors),
      newVisitors: n(windowRow?.fresh),
      returningVisitors: n(windowRow?.returning),
      signedInSessions: n(windowRow?.signedin),
      anonymousSessions: Math.max(0, windowSessions - n(windowRow?.signedin)),
    },
    series: fillBuckets(series, since, now, spec.bucketMs),
    sources: sources.map((r) => ({ key: r.key, count: n(r.count) })),
    pages: pages.map((r) => ({ key: r.key, count: n(r.count) })),
    devices: devices.map((r) => ({ key: r.key, count: n(r.count) })),
    browsers: browsers.map((r) => ({ key: r.key, count: n(r.count) })),
    operatingSystems: operatingSystems.map((r) => ({ key: r.key, count: n(r.count) })),
    countries: countries.map((r) => ({ key: r.key, count: n(r.count) })),
    recent: recent.map((r) => ({
      sessionId: r.id,
      name: r.name,
      userId: r.userId,
      startedAt: r.startedAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      device: r.device,
      browser: r.browser,
      os: r.os,
      country: r.country,
      source: r.source,
      landingPath: r.landingPath,
      pageViews: n(r.views),
      isReturning: r.isReturning,
      live: r.lastSeenAt >= liveSince,
    })),
    retentionDays: ANALYTICS.retentionDays,
  };
}

/**
 * Every bucket in the window, including the empty ones.
 *
 * A chart drawn only from rows that exist would compress quiet hours out of the axis and make traffic look
 * continuous when it was not — the gaps are part of the answer.
 */
function fillBuckets(rows: { bucket: Date; visitors: bigint; views: bigint }[], since: Date, now: Date, bucketMs: number): Bucket[] {
  const byStart = new Map<number, { visitors: number; views: number }>();
  for (const row of rows) byStart.set(Math.floor(row.bucket.getTime() / bucketMs) * bucketMs, { visitors: n(row.visitors), views: n(row.views) });

  const out: Bucket[] = [];
  const first = Math.floor(since.getTime() / bucketMs) * bucketMs;
  const last = Math.floor(now.getTime() / bucketMs) * bucketMs;
  for (let t = first; t <= last; t += bucketMs) {
    const hit = byStart.get(t);
    out.push({ startsAt: new Date(t).toISOString(), visitors: hit?.visitors ?? 0, pageViews: hit?.views ?? 0 });
  }
  return out;
}

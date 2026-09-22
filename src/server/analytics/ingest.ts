/**
 * Recording one analytics event (docs/ARCHITECTURE.md §30.3).
 *
 * THE SHAPE. A browser posts `{ eventKey, type, path, referrer }` and nothing else that is believed. Everything
 * that decides anything — who the visitor is, which session this belongs to, whether they are signed in, whether
 * they are staff, what country the edge saw — is resolved HERE, from the request and the database. The client
 * cannot claim a visitor id, cannot claim a user id, and cannot claim it is not staff.
 *
 * IDEMPOTENCY IS A CONSTRAINT, NOT A CONVENTION. `AnalyticsEvent.eventKey` is UNIQUE and the insert is
 * `ON CONFLICT DO NOTHING`. The client mints one key per navigation, so a double-invoked effect (React strict
 * mode), a retried request, a replayed beacon and a reconnecting client all present the same key and the database
 * keeps exactly one row. Nothing counts, compares timestamps or trusts a flag — the same rule the push delivery
 * engine uses, for the same reason.
 *
 * SESSIONS ARE DECIDED BY THE DATABASE, NOT THE COOKIE. A cookie says which session to look for; whether that
 * session is still alive is `lastSeenAt >= now - sessionIdleMs`, read from the row. So a stale cookie, a cookie
 * restored from another device, or a clock the browser disagrees with cannot resurrect a session that has
 * expired, and two tabs sharing the cookie correctly share one session.
 */
import { ANALYTICS } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import {
  attributeReferrer,
  classifyBrowser,
  classifyDevice,
  classifyOs,
  isTrackablePath,
  normalizeCountry,
  normalizePath,
  type DeviceKind,
  type TrafficSource,
} from "@/lib/analytics/classify";
import { consumeRateLimit } from "@/server/auth/rate-limit";

export const VISITOR_COOKIE = "mc_vid";
export const SESSION_COOKIE_NAME = "mc_sid";

export type AnalyticsEventType = "PAGE_VIEW" | "SESSION_START" | "SIGNUP_STARTED" | "SIGNUP_COMPLETED" | "LOGIN" | "ONBOARDING_COMPLETED";

/** What the browser sent, already shape-validated by the route. Still not trusted for anything but its content. */
export interface IngestInput {
  eventKey: string;
  type: AnalyticsEventType;
  path?: string | null;
  referrer?: string | null;
}

/** What the request itself tells us. Read from headers and cookies by the route; never from the body. */
export interface IngestContext {
  visitorCookie: string | null;
  sessionCookie: string | null;
  /** Reduced to buckets immediately; the raw string is never stored and never leaves this call. */
  userAgent: string | null;
  /** Edge-provided two-letter country, if the platform offered one. */
  countryHeader: string | null;
  /** Hostnames this deployment answers on, so a referral from ourselves is not counted as acquisition. */
  ownHosts: readonly string[];
  /** Resolved from the session cookie by the caller. Null unless a real, valid session exists. */
  userId: string | null;
  /** True when that session belongs to an operational STAFF account. */
  isStaff: boolean;
  /**
   * The referring URL as the browser reported it, used ONLY when a session is being created and never stored as
   * given — `attributeReferrer` reduces it to a source and a host first.
   */
  referrer?: string | null;
}

export type IngestOutcome =
  | { status: "recorded"; visitorId: string; sessionId: string; startedSession: boolean }
  | { status: "duplicate"; visitorId: string; sessionId: string; startedSession: boolean }
  | { status: "ignored"; reason: "untrackable-path" | "rate-limited" };

interface ResolvedSession {
  sessionId: string;
  visitorId: string;
  startedSession: boolean;
}

/**
 * Finds or creates the visitor.
 *
 * A cookie value is only ever used to LOOK ONE UP. If it does not match a row — forged, stale, or from a database
 * that has since been purged — a fresh visitor is minted with a server-generated id. There is no path by which a
 * client-supplied string becomes a stored identifier.
 */
async function resolveVisitor(db: Db, cookie: string | null, now: Date): Promise<{ id: string; isReturning: boolean } | null> {
  if (cookie && /^[a-z0-9]{8,32}$/i.test(cookie)) {
    const existing = await db.visitor.findUnique({ where: { id: cookie }, select: { id: true } });
    if (existing) {
      const gate = await consumeRateLimit(db, `analytics:v:${existing.id}`, ANALYTICS.eventsPerMinute, 60_000, now);
      if (!gate.allowed) return null;
      await db.visitor.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
      return { id: existing.id, isReturning: true };
    }
  }

  /*
   * Nobody we know. The limit has to be taken BEFORE the row is created, and it cannot be keyed on the visitor —
   * that id does not exist yet, and minting one to key the limit on is how a cookie-less flood would evade it
   * while writing a row per request. Keying it on an address is the other obvious answer and is precisely what
   * this feature refuses to do, so the creation of new visitors is capped as a whole (§30.3).
   */
  const gate = await consumeRateLimit(db, "analytics:new-visitor", ANALYTICS.newVisitorsPerMinute, 60_000, now);
  if (!gate.allowed) return null;
  const created = await db.visitor.create({ data: { firstSeenAt: now, lastSeenAt: now, sessionCount: 0 }, select: { id: true } });
  return { id: created.id, isReturning: false };
}

/**
 * Finds the live session or starts a new one.
 *
 * "Live" is decided from `lastSeenAt`, never from the cookie's own expiry, so the 30-minute rule holds even when
 * the browser kept a cookie it should have dropped. A session belonging to a different visitor is refused rather
 * than adopted: that combination means a copied or crafted cookie, and adopting it would splice two people's
 * traffic together.
 */
async function resolveSession(
  db: Db,
  input: { visitorId: string; isReturning: boolean; cookie: string | null; now: Date; context: IngestContext; landingPath: string | null },
): Promise<ResolvedSession> {
  const { visitorId, cookie, now, context, landingPath } = input;
  const liveSince = new Date(now.getTime() - ANALYTICS.sessionIdleMs);

  if (cookie && /^[a-z0-9]{8,32}$/i.test(cookie)) {
    const existing = await db.visitorSession.findUnique({
      where: { id: cookie },
      select: { id: true, visitorId: true, lastSeenAt: true, userId: true, excluded: true },
    });
    if (existing && existing.visitorId === visitorId && existing.lastSeenAt >= liveSince) {
      await db.visitorSession.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: now,
          // A session that began anonymous and then signed in is the same visit; the identity is attached to it
          // from that point. It is never removed once set, and never inferred — only a real session sets it.
          ...(context.userId && !existing.userId ? { userId: context.userId } : {}),
          // Staff exclusion is sticky: once an operator is recognised, the whole visit leaves the figures,
          // including the pages they saw before signing in.
          ...(context.isStaff && !existing.excluded ? { excluded: true } : {}),
        },
      });
      return { sessionId: existing.id, visitorId, startedSession: false };
    }
  }

  const attribution = attributeReferrer(context.referrer ?? null, context.ownHosts);
  const created = await db.visitorSession.create({
    data: {
      visitorId,
      userId: context.userId,
      startedAt: now,
      lastSeenAt: now,
      source: attribution.source as TrafficSource,
      referrerHost: attribution.host,
      device: classifyDevice(context.userAgent) as DeviceKind,
      browser: classifyBrowser(context.userAgent),
      os: classifyOs(context.userAgent),
      country: normalizeCountry(context.countryHeader),
      landingPath,
      isReturning: input.isReturning,
      excluded: context.isStaff,
    },
    select: { id: true },
  });
  await db.visitor.update({ where: { id: visitorId }, data: { sessionCount: { increment: 1 } } });
  return { sessionId: created.id, visitorId, startedSession: true };
}

/**
 * Records one event, or explains why it did not.
 *
 * Never throws into the caller: analytics is a courtesy and must not be able to fail a page.
 */
export async function recordEvent(input: IngestInput, context: IngestContext, options: { db?: Db; now?: Date } = {}): Promise<IngestOutcome> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const path = normalizePath(input.path);
  // A page view with no usable page, or a page we never record (admin, api), is dropped before it costs a row.
  if (input.type === "PAGE_VIEW" && !isTrackablePath(path)) return { status: "ignored", reason: "untrackable-path" };
  if (path && !isTrackablePath(path)) return { status: "ignored", reason: "untrackable-path" };

  // Resolving the visitor also takes the rate limit, because the two cannot be separated safely: the limit for a
  // caller we have never seen has to be taken before their row exists.
  const visitor = await resolveVisitor(db, context.visitorCookie, now);
  if (!visitor) return { status: "ignored", reason: "rate-limited" };

  const session = await resolveSession(db, {
    visitorId: visitor.id,
    isReturning: visitor.isReturning,
    cookie: context.sessionCookie,
    now,
    context: { ...context, referrer: input.referrer ?? null },
    landingPath: path,
  });

  /*
   * The claim. `ON CONFLICT DO NOTHING` means a second arrival of the same key writes nothing and reports
   * "duplicate" — which is a success, not an error: the event is already recorded.
   */
  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "AnalyticsEvent" ("id", "eventKey", "sessionId", "visitorId", "userId", "type", "path", "createdAt")
    VALUES (
      gen_random_uuid()::text, ${input.eventKey}, ${session.sessionId}, ${visitor.id},
      ${context.userId}, ${input.type}::"AnalyticsEventType", ${path}, ${now}
    )
    ON CONFLICT ("eventKey") DO NOTHING
    RETURNING "id"
  `;

  const base = { visitorId: visitor.id, sessionId: session.sessionId, startedSession: session.startedSession };
  return rows.length > 0 ? { status: "recorded", ...base } : { status: "duplicate", ...base };
}

/**
 * Deletes raw events past the retention horizon (docs/ARCHITECTURE.md §30.5).
 *
 * Idempotent and bounded: it deletes in capped batches and stops when a batch comes back short, so running it
 * twice in a row removes nothing the second time and a long backlog cannot hold a lock or blow a function
 * timeout. Sessions and visitors that no longer have events, and are themselves past the horizon, go too — an
 * expired visitor row with no events is a bare id that answers no question.
 */
export interface PurgeResult {
  events: number;
  sessions: number;
  visitors: number;
  /** True when a batch came back full, so there is more to remove on the next pass. */
  more: boolean;
}

export async function purgeExpiredAnalytics(options: { db?: Db; now?: Date } = {}): Promise<PurgeResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - ANALYTICS.retentionDays * 86_400_000);

  let events = 0;
  let more = false;
  for (let pass = 0; pass < ANALYTICS.purgeMaxBatches; pass += 1) {
    const deleted = await db.$executeRaw`
      DELETE FROM "AnalyticsEvent"
      WHERE "id" IN (
        SELECT "id" FROM "AnalyticsEvent" WHERE "createdAt" < ${cutoff} ORDER BY "createdAt" LIMIT ${ANALYTICS.purgeBatchSize}
      )
    `;
    events += deleted;
    if (deleted < ANALYTICS.purgeBatchSize) break;
    if (pass === ANALYTICS.purgeMaxBatches - 1) more = true;
  }

  // Only rows with nothing left pointing at them, and only past the horizon: a live session must survive a purge
  // that happens to run mid-visit.
  const sessions = await db.$executeRaw`
    DELETE FROM "VisitorSession" vs
    WHERE vs."lastSeenAt" < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "AnalyticsEvent" ae WHERE ae."sessionId" = vs."id")
  `;
  const visitors = await db.$executeRaw`
    DELETE FROM "Visitor" v
    WHERE v."lastSeenAt" < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "VisitorSession" vs WHERE vs."visitorId" = v."id")
      AND NOT EXISTS (SELECT 1 FROM "AnalyticsEvent" ae WHERE ae."visitorId" = v."id")
  `;

  return { events, sessions, visitors, more };
}

/** Rate-limited purge for ordinary admin traffic, so retention holds even if no scheduler ever calls the cron. */
export async function maybePurgeExpiredAnalytics(options: { db?: Db; now?: Date } = {}): Promise<PurgeResult | null> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const gate = await consumeRateLimit(db, "analytics:purge", 1, ANALYTICS.purgeEveryMs, now);
  if (!gate.allowed) return null;
  return purgeExpiredAnalytics({ db, now });
}

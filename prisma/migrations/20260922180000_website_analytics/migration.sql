-- Website analytics: visitors, sessions and events (docs/ARCHITECTURE.md §30).
--
-- ADDITIVE ONLY. Three new tables, three new enums, and not one ALTER against an existing table — nothing that
-- already holds a row is touched, so this cannot fail on production data and cannot change existing behaviour.
--
-- WHAT IS NOT IN THESE TABLES IS THE POINT. There is no "ip" column, no "userAgent" column and no fingerprint
-- column, because a column that does not exist cannot later be filled in by accident. Identity reaches analytics
-- through exactly one door: "userId", written only from a server-verified session cookie and nulled on account
-- deletion, so a deleted member's traffic reverts to what it always was — anonymous.
--
-- "AnalyticsEvent.eventKey" carries a UNIQUE index and is the whole duplicate story: ingest inserts
-- ON CONFLICT DO NOTHING, so a double-invoked React effect, a retried beacon, a replayed request and a
-- reconnecting client all collide on the same key and exactly one row survives. Nothing counts or compares
-- timestamps to decide; the constraint decides.

-- CreateEnum
CREATE TYPE "TrafficSource" AS ENUM ('DIRECT', 'GOOGLE', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'TWITTER', 'SNAPCHAT', 'YOUTUBE', 'WHATSAPP', 'TELEGRAM', 'LINKEDIN', 'REDDIT', 'BING', 'EMAIL', 'OTHER');
-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('MOBILE', 'TABLET', 'DESKTOP', 'UNKNOWN');
-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('PAGE_VIEW', 'SESSION_START', 'SIGNUP_STARTED', 'SIGNUP_COMPLETED', 'LOGIN', 'ONBOARDING_COMPLETED');
-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionCount" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "VisitorSession" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "TrafficSource" NOT NULL DEFAULT 'DIRECT',
    "referrerHost" TEXT,
    "device" "DeviceKind" NOT NULL DEFAULT 'UNKNOWN',
    "browser" TEXT,
    "os" TEXT,
    "country" TEXT,
    "landingPath" TEXT,
    "isReturning" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "AnalyticsEventType" NOT NULL,
    "path" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "Visitor_lastSeenAt_idx" ON "Visitor"("lastSeenAt");
-- CreateIndex
CREATE INDEX "Visitor_firstSeenAt_idx" ON "Visitor"("firstSeenAt");
-- CreateIndex
CREATE INDEX "VisitorSession_visitorId_idx" ON "VisitorSession"("visitorId");
-- CreateIndex
CREATE INDEX "VisitorSession_startedAt_idx" ON "VisitorSession"("startedAt");
-- CreateIndex
CREATE INDEX "VisitorSession_lastSeenAt_idx" ON "VisitorSession"("lastSeenAt");
-- CreateIndex
CREATE INDEX "VisitorSession_excluded_startedAt_idx" ON "VisitorSession"("excluded", "startedAt");
-- CreateIndex
CREATE INDEX "VisitorSession_userId_idx" ON "VisitorSession"("userId");
-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_eventKey_key" ON "AnalyticsEvent"("eventKey");
-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");
-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent"("type", "createdAt");
-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_idx" ON "AnalyticsEvent"("sessionId");
-- CreateIndex
CREATE INDEX "AnalyticsEvent_visitorId_idx" ON "AnalyticsEvent"("visitorId");
-- CreateIndex
CREATE INDEX "AnalyticsEvent_path_createdAt_idx" ON "AnalyticsEvent"("path", "createdAt");
-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security. Every table in this database has RLS enabled with no policies, so the only way in is the
-- server's own pooled connection (docs/ARCHITECTURE.md §5). It matters here because these rows describe people
-- who have not signed in and cannot consent to anything: the database must refuse them to every other route.
ALTER TABLE "Visitor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisitorSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsEvent" ENABLE ROW LEVEL SECURITY;

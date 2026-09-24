-- Plus funnel events (docs/ARCHITECTURE.md §12.19).
--
-- ADDITIVE ONLY. One new table with its own indexes, foreign keys and RLS. No ALTER against any existing table, no
-- new enum, no backfill: nothing that already holds a row is touched, so this cannot fail on production data and
-- cannot change existing behaviour. Writes are gated by PLUS_FUNNEL_ANALYTICS (off by default), so the table stays
-- empty until that switch is turned on.
--
-- "event" and "surface" are TEXT with CHECK constraints rather than enums, so rolling the application back leaves
-- rows the old code never reads, instead of enum values an older generated client cannot decode.

-- CreateTable
CREATE TABLE "PlusFunnelEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "userId" TEXT,
    "event" TEXT NOT NULL,
    "surface" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlusFunnelEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlusFunnelEvent_event_check" CHECK ("event" IN ('plus_prompt_viewed', 'plus_prompt_clicked', 'plus_checkout_started', 'plus_payment_instructions_viewed', 'plus_receipt_uploaded', 'plus_payment_approved')),
    CONSTRAINT "PlusFunnelEvent_surface_check" CHECK ("surface" IS NULL OR "surface" IN ('likes_you', 'discover_likes', 'daily_limit', 'photo_lock', 'undo', 'membership', 'checkout_recovery'))
);

-- CreateIndex
CREATE UNIQUE INDEX "PlusFunnelEvent_eventKey_key" ON "PlusFunnelEvent"("eventKey");
-- CreateIndex
CREATE INDEX "PlusFunnelEvent_createdAt_idx" ON "PlusFunnelEvent"("createdAt");
-- CreateIndex
CREATE INDEX "PlusFunnelEvent_event_createdAt_idx" ON "PlusFunnelEvent"("event", "createdAt");
-- CreateIndex
CREATE INDEX "PlusFunnelEvent_orderId_idx" ON "PlusFunnelEvent"("orderId");

-- AddForeignKey
ALTER TABLE "PlusFunnelEvent" ADD CONSTRAINT "PlusFunnelEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PlusFunnelEvent" ADD CONSTRAINT "PlusFunnelEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SubscriptionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security, as on every other table: enabled with no policies, so the only way in is the server's own
-- pooled connection (docs/ARCHITECTURE.md §5).
ALTER TABLE "PlusFunnelEvent" ENABLE ROW LEVEL SECURITY;

-- Super Likes (docs/ARCHITECTURE.md §12.20). Additive only.
--
-- 1. Like.kind: every existing like reads as NORMAL through the column default (a constant default is a metadata-only
--    change on PostgreSQL 11+: no table rewrite, no backfill). Nothing is ever converted to SUPER.
-- 2. UsageKind gains SUPER_LIKES, the 7-day allowance counter (one UsageCounter row per member, created on first use).
--    ADD VALUE only appends a label; no existing counter row changes.
-- 3. PlusFunnelEvent's two CHECK constraints are widened to allow the Super Like events and the "super_like" surface.
--    Each is replaced by a strict superset of itself, so every existing row still satisfies it; the re-check is a
--    scan of a small, analytics-only table under a brief lock. No row is changed.
--
-- The optional intro message reuses the existing, unused "Intro" table through the existing "Like"."introId" link, so
-- there is no new table and no change to "Intro", "Message" (whose kind already has INTRO) or "Notification".
--
-- Rollback (only while no SUPER likes / SUPER_LIKES counters exist, or after deleting them deliberately):
--   ALTER TABLE "Like" DROP COLUMN "kind";
--   DROP TYPE "LikeKind";
--   -- An enum value cannot be dropped in PostgreSQL; an unused 'SUPER_LIKES' label is harmless and can stay.
--   -- The funnel checks go back to their previous lists NOT VALID, so rows already written are kept, not rejected:
--   ALTER TABLE "PlusFunnelEvent" DROP CONSTRAINT "PlusFunnelEvent_event_check",
--     ADD CONSTRAINT "PlusFunnelEvent_event_check" CHECK ("event" IN ('plus_prompt_viewed', 'plus_prompt_clicked', 'plus_checkout_started', 'plus_payment_instructions_viewed', 'plus_receipt_uploaded', 'plus_payment_approved')) NOT VALID;
--   ALTER TABLE "PlusFunnelEvent" DROP CONSTRAINT "PlusFunnelEvent_surface_check",
--     ADD CONSTRAINT "PlusFunnelEvent_surface_check" CHECK ("surface" IS NULL OR "surface" IN ('likes_you', 'discover_likes', 'daily_limit', 'photo_lock', 'undo', 'membership', 'checkout_recovery')) NOT VALID;
CREATE TYPE "LikeKind" AS ENUM ('NORMAL', 'SUPER');
ALTER TABLE "Like" ADD COLUMN "kind" "LikeKind" NOT NULL DEFAULT 'NORMAL';
ALTER TYPE "UsageKind" ADD VALUE 'SUPER_LIKES';

ALTER TABLE "PlusFunnelEvent" DROP CONSTRAINT "PlusFunnelEvent_event_check",
  ADD CONSTRAINT "PlusFunnelEvent_event_check" CHECK ("event" IN ('plus_prompt_viewed', 'plus_prompt_clicked', 'plus_checkout_started', 'plus_payment_instructions_viewed', 'plus_receipt_uploaded', 'plus_payment_approved', 'super_like_composer_opened', 'super_like_sent', 'super_like_with_message_sent', 'super_like_matched'));
ALTER TABLE "PlusFunnelEvent" DROP CONSTRAINT "PlusFunnelEvent_surface_check",
  ADD CONSTRAINT "PlusFunnelEvent_surface_check" CHECK ("surface" IS NULL OR "surface" IN ('likes_you', 'discover_likes', 'daily_limit', 'photo_lock', 'undo', 'membership', 'checkout_recovery', 'super_like'));

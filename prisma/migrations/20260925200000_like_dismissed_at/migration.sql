-- Likes You: a recipient's explicit "no" to one incoming like (docs/ARCHITECTURE.md §12.5).
--
-- Additive only. One nullable column, no default, no backfill: every existing like reads as not dismissed, which
-- is exactly its state today. Set only by a Pass tapped on Likes You; a Pass made in Discover never sets it.
-- Rollback: ALTER TABLE "Like" DROP COLUMN "dismissedAt"; (nothing else references it).
ALTER TABLE "Like" ADD COLUMN "dismissedAt" TIMESTAMP(3);

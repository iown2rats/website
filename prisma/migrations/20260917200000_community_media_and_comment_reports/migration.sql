-- Community media moderation state and comment reports (Phase 8).
ALTER TABLE "CommunityPost" ADD COLUMN "photoModeration" "PhotoModeration" NOT NULL DEFAULT 'PENDING';

ALTER TABLE "Report" ADD COLUMN "targetCommentId" TEXT;
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetCommentId_fkey" FOREIGN KEY ("targetCommentId") REFERENCES "CommunityComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Report_targetCommentId_idx" ON "Report"("targetCommentId");

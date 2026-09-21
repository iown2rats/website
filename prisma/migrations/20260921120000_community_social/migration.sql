-- Community: poll and confession post kinds, topic chips, and private follows.
--
-- Additive only. No existing column changes type or nullability, no data is rewritten, and every post already in
-- the table keeps working: `topic` is null (no chip) and `isAnonymous` is false (author shown), which is exactly
-- what those posts already mean.
--
-- CommunityPost.authorId stays NOT NULL for confessions too. Anonymity is a presentation rule applied in the DTO,
-- never a gap in the record, so moderation, reports and the admin surfaces are unaffected by it.
-- CreateEnum
CREATE TYPE "PostTopic" AS ENUM ('DATING', 'ADVICE', 'CONFESSIONS', 'QUESTIONS', 'POLLS', 'RANDOM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PostKind" ADD VALUE 'POLL';
ALTER TYPE "PostKind" ADD VALUE 'CONFESSION';

-- AlterTable
ALTER TABLE "CommunityPost" ADD COLUMN     "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "topic" "PostTopic";

-- CreateTable
CREATE TABLE "CommunityPollOption" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityPollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityPollVote" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityPollVote_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "CommunityFollow" (
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityFollow_pkey" PRIMARY KEY ("followerId","followingId")
);

-- CreateIndex
CREATE INDEX "CommunityPollOption_postId_idx" ON "CommunityPollOption"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityPollOption_postId_position_key" ON "CommunityPollOption"("postId", "position");

-- CreateIndex
CREATE INDEX "CommunityPollVote_optionId_idx" ON "CommunityPollVote"("optionId");

-- CreateIndex
CREATE INDEX "CommunityFollow_followerId_createdAt_idx" ON "CommunityFollow"("followerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CommunityFollow_followingId_idx" ON "CommunityFollow"("followingId");

-- CreateIndex
CREATE INDEX "CommunityPost_topic_deletedAt_createdAt_idx" ON "CommunityPost"("topic", "deletedAt", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "CommunityPollOption" ADD CONSTRAINT "CommunityPollOption_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPollVote" ADD CONSTRAINT "CommunityPollVote_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPollVote" ADD CONSTRAINT "CommunityPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPollVote" ADD CONSTRAINT "CommunityPollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "CommunityPollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityFollow" ADD CONSTRAINT "CommunityFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityFollow" ADD CONSTRAINT "CommunityFollow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security.
--
-- Every table in this database has RLS ENABLED WITH NO POLICIES, so the anon and authenticated roles — which hold
-- table grants and are reachable with the public Supabase key — can read and write nothing. The app reaches the
-- database as the owner through Prisma and is unaffected. A new table that skips this is a hole in that wall:
-- 20260920220000_welcome_covers shipped without it and had to be fixed in production the same week.
ALTER TABLE "CommunityPollOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommunityPollVote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommunityFollow" ENABLE ROW LEVEL SECURITY;

-- Replies, edits and reactions for Chat and Community.
--
-- ADDITIVE ONLY, and checked against production rather than assumed. Nothing here rewrites a row, changes a
-- column's type or nullability, or drops anything.
--
--   * "CommunityLike" is the one LIVE table that changes, and it gains a single column with a DEFAULT. Every row
--     already in it is a ❤️ from that member on that post, which is exactly what 'HEART' means, so the existing
--     3 production rows become correct reactions without being touched. The table keeps its name on purpose: a
--     rename is not an additive migration.
--   * "Message" and "Conversation" gain nullable columns only. Null reads as "not a reply", "never edited" and
--     "nothing has been reacted to here", which is true of every message and conversation already stored.
--   * The two new tables are created empty, which is why their "updatedAt" may be NOT NULL. It still carries a
--     database default, because the reaction upserts are raw ON CONFLICT statements and raw SQL never goes
--     through Prisma's @updatedAt.
--   * The enum values are APPENDED. `ALTER TYPE ... ADD VALUE` appends in Postgres, so the order here is the
--     order in schema.prisma and the database and the schema stay identical (as with PostKind's POLL/CONFESSION).
--     Neither new value is used in this transaction, which is what Postgres requires of ADD VALUE.
--
-- One active reaction per member per target is enforced by the composite PRIMARY KEY on each reaction table, not
-- by application code counting rows: a duplicate request cannot create a second reaction because there is nowhere
-- for it to go.

-- CreateEnum
CREATE TYPE "ReactionEmoji" AS ENUM ('HEART', 'LAUGH', 'WOW', 'SAD', 'THUMBS_UP', 'FIRE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'MESSAGE_REACTION';
ALTER TYPE "NotificationType" ADD VALUE 'COMMUNITY_COMMENT_REACTION';

-- AlterTable
ALTER TABLE "CommunityLike" ADD COLUMN     "emoji" "ReactionEmoji" NOT NULL DEFAULT 'HEART';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "interactionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "replyToMessageId" TEXT;

-- CreateTable
CREATE TABLE "MessageReaction" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" "ReactionEmoji" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateTable
CREATE TABLE "CommunityCommentReaction" (
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" "ReactionEmoji" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityCommentReaction_pkey" PRIMARY KEY ("commentId","userId")
);

-- CreateIndex
CREATE INDEX "MessageReaction_userId_idx" ON "MessageReaction"("userId");

-- CreateIndex
CREATE INDEX "CommunityCommentReaction_userId_idx" ON "CommunityCommentReaction"("userId");

-- CreateIndex
CREATE INDEX "Message_replyToMessageId_idx" ON "Message"("replyToMessageId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentReaction" ADD CONSTRAINT "CommunityCommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentReaction" ADD CONSTRAINT "CommunityCommentReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security. Every table in this database has RLS enabled with no policies, so the only way in is the
-- server's own pooled connection (docs/ARCHITECTURE.md §5). A new table without this line would be the one table
-- reachable by anon or authenticated Supabase keys.
ALTER TABLE "MessageReaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommunityCommentReaction" ENABLE ROW LEVEL SECURITY;

-- Push notifications: devices, delivery records and opt-in preferences.
--
-- ADDITIVE ONLY. Nothing is rewritten, retyped or dropped.
--
--   * "PushSubscription" existed since Phase 9 as an unused placeholder and holds ZERO rows in production, so the
--     new columns land on an empty table. It keeps its name rather than becoming "PushDevice": a rename is not an
--     additive migration, and the name still describes what a row is.
--   * "NotificationSettings" gains seven booleans, every one DEFAULT false. Push requires a browser permission the
--     member grants deliberately; a default of true would notify someone's phone because a column said so.
--     The five existing columns are untouched, so the in-app feed behaves exactly as before.
--   * "PushDelivery" is new and is the idempotency key of the whole system: UNIQUE (notificationId,
--     subscriptionId). The sender INSERTs its claim before sending, so a retried job, a replayed request, a
--     polling page, a reconnecting client and a re-running sweep all collide with the same row and send nothing.

-- CreateEnum
CREATE TYPE "PushTransport" AS ENUM ('WEBPUSH', 'FCM');

-- CreateEnum
CREATE TYPE "PushDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "NotificationSettings" ADD COLUMN     "push" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushCommunity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushLikes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushMatches" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushMessages" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushReactions" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "failureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "transport" "PushTransport" NOT NULL DEFAULT 'WEBPUSH',
ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushDelivery_status_createdAt_idx" ON "PushDelivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_notificationId_subscriptionId_key" ON "PushDelivery"("notificationId", "subscriptionId");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_disabledAt_idx" ON "PushSubscription"("userId", "disabledAt");

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security. Every table in this database has RLS enabled with no policies, so the only way in is the
-- server's own pooled connection (docs/ARCHITECTURE.md §5). A push device row holds the keys that decrypt that
-- member's notifications, which makes this line matter more here than almost anywhere else.
ALTER TABLE "PushDelivery" ENABLE ROW LEVEL SECURITY;

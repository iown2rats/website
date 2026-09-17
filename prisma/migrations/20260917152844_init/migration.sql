-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('WOMAN', 'MAN', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "InterestedIn" AS ENUM ('WOMEN', 'MEN', 'EVERYONE');

-- CreateEnum
CREATE TYPE "RelationshipIntent" AS ENUM ('SERIOUS_RELATIONSHIP', 'DATING', 'MARRIAGE', 'FIGURING_OUT');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('EVERYONE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('CITY', 'ISLAND', 'ATOLL');

-- CreateEnum
CREATE TYPE "LocationScope" AS ENUM ('ANYWHERE', 'GREATER_MALE', 'MY_ATOLL', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "PhotoModeration" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('ACTIVE', 'UNMATCHED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('PENDING', 'ACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'INTRO', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('FAKE_PROFILE', 'UNDERAGE_USER', 'HARASSMENT', 'INAPPROPRIATE_CONTENT', 'SCAM_OR_FINANCIAL_REQUEST', 'IMPERSONATION', 'SPAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NONE', 'PHONE_VERIFIED', 'SELFIE_SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EntitlementTier" AS ENUM ('FREE', 'PLUS');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('LIKES', 'BOOSTS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_MATCH', 'MESSAGE', 'LIKE_RECEIVED', 'INTRO_RECEIVED', 'COMMUNITY_LIKE', 'COMMUNITY_COMMENT', 'VERIFICATION_UPDATE', 'SAFETY_NOTICE', 'ACCOUNT_NOTICE');

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('TEXT', 'QUESTION', 'PHOTO');

-- CreateEnum
CREATE TYPE "ContactHashSource" AS ENUM ('PICKER', 'MANUAL', 'NATIVE_IMPORT');

-- CreateEnum
CREATE TYPE "BlockSource" AS ENUM ('MANUAL', 'REPORT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "phoneHash" BYTEA NOT NULL,
    "phoneHashVersion" INTEGER NOT NULL DEFAULT 1,
    "dateOfBirth" DATE,
    "gender" "Gender",
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ONBOARDING',
    "onboardingStep" INTEGER NOT NULL DEFAULT 2,
    "onboardingCompletedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "occupation" TEXT,
    "education" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heightCm" INTEGER,
    "intent" "RelationshipIntent",
    "locationId" TEXT,
    "homeLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfilePhoto" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "blurhash" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "moderation" "PhotoModeration" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL,
    "atollCode" TEXT NOT NULL,
    "atollName" TEXT NOT NULL,
    "isGreaterMale" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interest" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Interest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileInterest" (
    "profileId" TEXT NOT NULL,
    "interestId" TEXT NOT NULL,

    CONSTRAINT "ProfileInterest_pkey" PRIMARY KEY ("profileId","interestId")
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Prompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfilePrompt" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfilePrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacySettings" (
    "userId" TEXT NOT NULL,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'EVERYONE',
    "invisibleMode" BOOLEAN NOT NULL DEFAULT false,
    "hideLocation" BOOLEAN NOT NULL DEFAULT false,
    "hideAge" BOOLEAN NOT NULL DEFAULT false,
    "hideActiveStatus" BOOLEAN NOT NULL DEFAULT false,
    "readReceipts" BOOLEAN NOT NULL DEFAULT true,
    "profileSharing" BOOLEAN NOT NULL DEFAULT true,
    "blockContacts" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacySettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "DiscoveryPreferences" (
    "userId" TEXT NOT NULL,
    "interestedIn" "InterestedIn" NOT NULL DEFAULT 'EVERYONE',
    "ageMin" INTEGER NOT NULL DEFAULT 22,
    "ageMax" INTEGER NOT NULL DEFAULT 34,
    "locationScope" "LocationScope" NOT NULL DEFAULT 'ANYWHERE',
    "locationId" TEXT,
    "intent" "RelationshipIntent",
    "heightMinCm" INTEGER,
    "heightMaxCm" INTEGER,
    "education" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryPreferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "userId" TEXT NOT NULL,
    "matches" BOOLEAN NOT NULL DEFAULT true,
    "likes" BOOLEAN NOT NULL DEFAULT true,
    "messages" BOOLEAN NOT NULL DEFAULT true,
    "community" BOOLEAN NOT NULL DEFAULT false,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "OtpRequest" (
    "id" TEXT NOT NULL,
    "phoneHash" BYTEA NOT NULL,
    "codeHash" BYTEA NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ipHash" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipPrefix" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "Like" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "introId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pass" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unmatchedAt" TIMESTAMP(3),
    "unmatchedById" TEXT,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "matchId" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'PENDING',
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadMessageId" TEXT,
    "lastReadAt" TIMESTAMP(3),
    "mutedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intro" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Intro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "userId" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("userId","kind")
);

-- CreateTable
CREATE TABLE "Boost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Boost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MVR',
    "badge" TEXT,
    "discountLabel" TEXT,
    "isPlaceholderPrice" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCustomerRef" TEXT,
    "providerSubscriptionRef" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "EntitlementTier" NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedById" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "source" "BlockSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetPostId" TEXT,
    "targetMessageId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT,
    "snapshot" JSONB,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "userId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'NONE',
    "selfieStorageKey" TEXT,
    "provider" TEXT,
    "providerRef" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CommunityPost" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "PostKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "photoKey" TEXT,
    "photoBlurhash" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CommunityComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityLike" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityLike_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "actorId" TEXT,
    "conversationId" TEXT,
    "postId" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactHash" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hash" BYTEA NOT NULL,
    "hashVersion" INTEGER NOT NULL DEFAULT 1,
    "source" "ContactHashSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactHash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneE164_key" ON "User"("phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- CreateIndex
CREATE INDEX "User_status_onboardingCompletedAt_idx" ON "User"("status", "onboardingCompletedAt");

-- CreateIndex
CREATE INDEX "User_lastActiveAt_idx" ON "User"("lastActiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_handle_key" ON "Profile"("handle");

-- CreateIndex
CREATE INDEX "Profile_locationId_idx" ON "Profile"("locationId");

-- CreateIndex
CREATE INDEX "Profile_intent_idx" ON "Profile"("intent");

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePhoto_profileId_position_key" ON "ProfilePhoto"("profileId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePhoto_storageKey_key" ON "ProfilePhoto"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");

-- CreateIndex
CREATE INDEX "Location_atollCode_idx" ON "Location"("atollCode");

-- CreateIndex
CREATE UNIQUE INDEX "Interest_slug_key" ON "Interest"("slug");

-- CreateIndex
CREATE INDEX "ProfileInterest_interestId_idx" ON "ProfileInterest"("interestId");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_slug_key" ON "Prompt"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePrompt_profileId_promptId_key" ON "ProfilePrompt"("profileId", "promptId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePrompt_profileId_position_key" ON "ProfilePrompt"("profileId", "position");

-- CreateIndex
CREATE INDEX "OtpRequest_phoneHash_createdAt_idx" ON "OtpRequest"("phoneHash", "createdAt");

-- CreateIndex
CREATE INDEX "OtpRequest_expiresAt_idx" ON "OtpRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "Like_introId_key" ON "Like"("introId");

-- CreateIndex
CREATE INDEX "Like_toUserId_createdAt_idx" ON "Like"("toUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Like_fromUserId_createdAt_idx" ON "Like"("fromUserId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Like_fromUserId_toUserId_key" ON "Like"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "Pass_fromUserId_createdAt_idx" ON "Pass"("fromUserId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Pass_fromUserId_toUserId_key" ON "Pass"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "Match_userAId_status_idx" ON "Match"("userAId", "status");

-- CreateIndex
CREATE INDEX "Match_userBId_status_idx" ON "Match"("userBId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Match_userAId_userBId_key" ON "Match"("userAId", "userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_matchId_key" ON "Conversation"("matchId");

-- CreateIndex
CREATE INDEX "Conversation_status_lastMessageAt_idx" ON "Conversation"("status", "lastMessageAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_userAId_userBId_key" ON "Conversation"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_senderId_kind_createdAt_idx" ON "Message"("senderId", "kind", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Intro_messageId_key" ON "Intro"("messageId");

-- CreateIndex
CREATE INDEX "Intro_fromUserId_weekKey_idx" ON "Intro"("fromUserId", "weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "Intro_fromUserId_toUserId_key" ON "Intro"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "Boost_userId_endsAt_idx" ON "Boost"("userId", "endsAt" DESC);

-- CreateIndex
CREATE INDEX "Boost_endsAt_idx" ON "Boost"("endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubscriptionRef_key" ON "Subscription"("providerSubscriptionRef");

-- CreateIndex
CREATE INDEX "Subscription_userId_currentPeriodEnd_idx" ON "Subscription"("userId", "currentPeriodEnd" DESC);

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "EntitlementOverride_userId_endsAt_idx" ON "EntitlementOverride"("userId", "endsAt" DESC);

-- CreateIndex
CREATE INDEX "Block_blockedId_idx" ON "Block"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_blockerId_blockedId_key" ON "Block"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_targetUserId_idx" ON "Report"("targetUserId");

-- CreateIndex
CREATE INDEX "Verification_status_submittedAt_idx" ON "Verification"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "CommunityPost_deletedAt_createdAt_idx" ON "CommunityPost"("deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CommunityPost_authorId_idx" ON "CommunityPost"("authorId");

-- CreateIndex
CREATE INDEX "CommunityComment_postId_createdAt_idx" ON "CommunityComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "ContactHash_hash_idx" ON "ContactHash"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "ContactHash_userId_hash_key" ON "ContactHash"("userId", "hash");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_homeLocationId_fkey" FOREIGN KEY ("homeLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileInterest" ADD CONSTRAINT "ProfileInterest_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileInterest" ADD CONSTRAINT "ProfileInterest_interestId_fkey" FOREIGN KEY ("interestId") REFERENCES "Interest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePrompt" ADD CONSTRAINT "ProfilePrompt_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePrompt" ADD CONSTRAINT "ProfilePrompt_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacySettings" ADD CONSTRAINT "PrivacySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryPreferences" ADD CONSTRAINT "DiscoveryPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryPreferences" ADD CONSTRAINT "DiscoveryPreferences_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_introId_fkey" FOREIGN KEY ("introId") REFERENCES "Intro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_unmatchedById_fkey" FOREIGN KEY ("unmatchedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intro" ADD CONSTRAINT "Intro_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intro" ADD CONSTRAINT "Intro_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intro" ADD CONSTRAINT "Intro_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boost" ADD CONSTRAINT "Boost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementOverride" ADD CONSTRAINT "EntitlementOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementOverride" ADD CONSTRAINT "EntitlementOverride_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetPostId_fkey" FOREIGN KEY ("targetPostId") REFERENCES "CommunityPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetMessageId_fkey" FOREIGN KEY ("targetMessageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityLike" ADD CONSTRAINT "CommunityLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityLike" ADD CONSTRAINT "CommunityLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactHash" ADD CONSTRAINT "ContactHash_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

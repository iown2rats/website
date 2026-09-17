-- Google-only authentication (docs/ARCHITECTURE.md §4.1).
-- Phone becomes optional profile / contact-blocking data; SMS OTP challenges are removed; identities map to User.id.

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

-- AlterTable: phone is no longer an authentication credential
ALTER TABLE "User" ALTER COLUMN "phoneE164" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "phoneHash" DROP NOT NULL;

-- AlterTable: recent re-authentication marker for destructive actions
ALTER TABLE "Session" ADD COLUMN "reauthenticatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerSubject_key" ON "AuthIdentity"("provider", "providerSubject");
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropTable: SMS OTP challenges no longer exist
DROP TABLE "OtpRequest";

-- Data: "phone verified" was a property of SMS sign-in, not an independent verification. Nobody keeps it.
UPDATE "Verification" SET "status" = 'NONE' WHERE "status" = 'PHONE_VERIFIED';

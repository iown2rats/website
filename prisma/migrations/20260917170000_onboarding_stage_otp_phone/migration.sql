-- CreateEnum
CREATE TYPE "OnboardingStage" AS ENUM ('NAME', 'DOB', 'GENDER', 'MEET', 'INTENT', 'LOCATION', 'PHOTOS', 'ABOUT', 'PRIVACY', 'COMPLETE');

-- AlterTable: replace the numeric step with a named stage
ALTER TABLE "User" DROP COLUMN "onboardingStep",
ADD COLUMN     "onboardingStage" "OnboardingStage" NOT NULL DEFAULT 'NAME';

-- AlterTable: OTP challenges carry the verified phone and a supersede marker
ALTER TABLE "OtpRequest" ADD COLUMN     "phoneE164" TEXT NOT NULL,
ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- Index direction change
DROP INDEX "OtpRequest_phoneHash_createdAt_idx";
CREATE INDEX "OtpRequest_phoneHash_createdAt_idx" ON "OtpRequest"("phoneHash", "createdAt" DESC);

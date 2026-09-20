-- CreateEnum
CREATE TYPE "ConnectionIntent" AS ENUM ('DATING', 'FRIENDSHIP');

-- AlterEnum
ALTER TYPE "OnboardingStage" ADD VALUE 'CONNECTION';

-- AlterTable
ALTER TABLE "DiscoveryPreferences" ADD COLUMN     "connectionIntent" "ConnectionIntent" NOT NULL DEFAULT 'DATING',
ADD COLUMN     "friendshipInterestedIn" "InterestedIn";

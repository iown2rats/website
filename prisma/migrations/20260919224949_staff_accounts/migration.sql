-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('MEMBER', 'STAFF');

-- CreateEnum
CREATE TYPE "StaffGrantStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountType" "AccountType" NOT NULL DEFAULT 'MEMBER';

-- CreateTable
CREATE TABLE "StaffGrant" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "StaffGrantStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffInvite" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffGrant_claimedByUserId_key" ON "StaffGrant"("claimedByUserId");

-- CreateIndex
CREATE INDEX "StaffGrant_status_createdAt_idx" ON "StaffGrant"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StaffGrant_email_idx" ON "StaffGrant"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffInvite_grantId_consumedAt_idx" ON "StaffInvite"("grantId", "consumedAt");

-- CreateIndex
CREATE INDEX "StaffInvite_expiresAt_idx" ON "StaffInvite"("expiresAt");

-- CreateIndex
CREATE INDEX "User_accountType_idx" ON "User"("accountType");

-- AddForeignKey
ALTER TABLE "StaffGrant" ADD CONSTRAINT "StaffGrant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffGrant" ADD CONSTRAINT "StaffGrant_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffGrant" ADD CONSTRAINT "StaffGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "StaffGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one live authorisation per address. A REVOKED grant is history and does not reserve the address, so
-- re-authorising someone later creates a new row. This is what makes "duplicate active/pending grant" impossible
-- under concurrency: two admins adding the same address race on this index and exactly one wins.
CREATE UNIQUE INDEX "StaffGrant_email_open_key" ON "StaffGrant" ("email") WHERE "status" <> 'REVOKED';

-- A grant may only confer staff authority. USER is never a staff role.
ALTER TABLE "StaffGrant" ADD CONSTRAINT "StaffGrant_role_is_staff" CHECK ("role" IN ('ADMIN', 'MODERATOR'));

-- An ACTIVE grant is always bound to the account that claimed it; a PENDING grant never is.
ALTER TABLE "StaffGrant" ADD CONSTRAINT "StaffGrant_claim_matches_status" CHECK (
  ("status" = 'ACTIVE' AND "claimedByUserId" IS NOT NULL AND "claimedAt" IS NOT NULL)
  OR ("status" = 'PENDING' AND "claimedByUserId" IS NULL)
  OR "status" = 'REVOKED'
);

-- Same treatment as every other public table (docs/DEPLOYMENT.md §3): RLS on, no policies. The application
-- reaches Postgres server-side as the `postgres` role (BYPASSRLS); anon and authenticated must see no rows.
ALTER TABLE "StaffGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffInvite" ENABLE ROW LEVEL SECURITY;

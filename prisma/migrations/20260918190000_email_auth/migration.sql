-- Email + password sign-in beside Google and Telegram (docs/ARCHITECTURE.md §4.1b).
-- Additive only: no existing row is read, changed or removed. Google and Telegram identities keep
-- passwordHash NULL and are untouched by email verification.

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- AlterEnum: a third identity provider
ALTER TYPE "AuthProvider" ADD VALUE 'EMAIL';

-- AlterTable: the password verifier for EMAIL identities (never a plaintext password)
ALTER TABLE "AuthIdentity" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "AuthIdentity" ADD COLUMN "passwordUpdatedAt" TIMESTAMP(3);

-- CreateTable: hashed, single-use, expiring email verification and password-reset tokens
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_identityId_purpose_idx" ON "AuthToken"("identityId", "purpose");
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "AuthIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: the application reaches Postgres server-side as the BYPASSRLS `postgres` role; the Data API roles must see
-- nothing, exactly as for every other table (docs/DEPLOYMENT.md §3).
ALTER TABLE "AuthToken" ENABLE ROW LEVEL SECURITY;

-- Telegram sign-in via OpenID Connect beside Google (docs/ARCHITECTURE.md §4.1).
-- Additive only: no rows are changed or removed.

-- AlterEnum: a second identity provider
ALTER TYPE "AuthProvider" ADD VALUE 'TELEGRAM';

-- AlterTable: Telegram issues no email claim, so the email becomes optional; the Telegram username is kept for display only
ALTER TABLE "AuthIdentity" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "AuthIdentity" ADD COLUMN "providerUsername" TEXT;

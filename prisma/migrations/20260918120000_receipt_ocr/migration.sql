-- OCR-assisted receipt verification (docs/ARCHITECTURE.md §12.14).
-- Additive only: one new enum and one new table. No existing row is touched.

-- CreateEnum
CREATE TYPE "ReceiptOutcome" AS ENUM ('MATCH', 'PARTIAL_MATCH', 'REVIEW_REQUIRED', 'MISMATCH', 'OCR_FAILED', 'UNSUPPORTED_RECEIPT');

-- CreateTable
CREATE TABLE "ReceiptVerification" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "outcome" "ReceiptOutcome" NOT NULL,
    "detectedBank" TEXT,
    "transactionStatus" TEXT NOT NULL,
    "amountMinor" INTEGER,
    "currency" TEXT,
    "transactionId" TEXT,
    "transactionIdHash" TEXT,
    "transactionAt" TIMESTAMP(3),
    "transactionDateRaw" TEXT,
    "recipientAccount" TEXT,
    "recipientName" TEXT,
    "senderName" TEXT,
    "remarks" TEXT,
    "checks" JSONB NOT NULL,
    "ocrConfidence" INTEGER,
    "durationMs" INTEGER,
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptVerification_orderId_attempt_key" ON "ReceiptVerification"("orderId", "attempt");

-- CreateIndex
CREATE INDEX "ReceiptVerification_orderId_createdAt_idx" ON "ReceiptVerification"("orderId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ReceiptVerification_transactionIdHash_idx" ON "ReceiptVerification"("transactionIdHash");

-- AddForeignKey
ALTER TABLE "ReceiptVerification" ADD CONSTRAINT "ReceiptVerification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SubscriptionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptVerification" ADD CONSTRAINT "ReceiptVerification_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

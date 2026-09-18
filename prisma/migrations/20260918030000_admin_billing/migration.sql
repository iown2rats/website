-- Admin dashboard + Plus subscription orders (docs/ARCHITECTURE.md §12.10–§12.12, §21).

-- Plans: admin-managed, free-form code so plans can be added without a migration.
ALTER TABLE "SubscriptionPlan" ALTER COLUMN "code" TYPE TEXT USING "code"::text;
DROP TYPE "PlanCode";
ALTER TABLE "SubscriptionPlan"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SubscriptionPlan" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('BANK_TRANSFER');
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- Notification types for billing
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_EXPIRED';

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL DEFAULT 'BANK_TRANSFER',
    "label" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MVR',
    "instructions" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionOrder" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "planName" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "methodLabel" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "instructions" TEXT,
    "receiptKey" TEXT,
    "receiptSize" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionOrder_pkey" PRIMARY KEY ("id")
);

-- Subscription ↔ order link (one order activates at most one period)
ALTER TABLE "Subscription" ADD COLUMN "orderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionOrder_reference_key" ON "SubscriptionOrder"("reference");
CREATE INDEX "SubscriptionOrder_userId_createdAt_idx" ON "SubscriptionOrder"("userId", "createdAt" DESC);
CREATE INDEX "SubscriptionOrder_status_submittedAt_idx" ON "SubscriptionOrder"("status", "submittedAt");
CREATE INDEX "SubscriptionOrder_status_expiresAt_idx" ON "SubscriptionOrder"("status", "expiresAt");
CREATE UNIQUE INDEX "Subscription_orderId_key" ON "Subscription"("orderId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SubscriptionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

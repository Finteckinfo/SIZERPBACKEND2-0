/*
  Warnings:

  - The values [TIMELY,PER_COMPLETION,RELEASED] on the enum `PaymentStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."PaymentStatus_new" AS ENUM ('PENDING', 'ALLOCATED', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED');
ALTER TABLE "public"."Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."Task" ALTER COLUMN "paymentStatus" DROP DEFAULT;
ALTER TABLE "public"."Task" ALTER COLUMN "paymentStatus" TYPE "public"."PaymentStatus_new" USING ("paymentStatus"::text::"public"."PaymentStatus_new");
ALTER TABLE "public"."Payment" ALTER COLUMN "status" TYPE "public"."PaymentStatus_new" USING ("status"::text::"public"."PaymentStatus_new");
ALTER TYPE "public"."PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "public"."PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "public"."PaymentStatus_old";
ALTER TABLE "public"."Payment" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "public"."Task" ALTER COLUMN "paymentStatus" SET DEFAULT 'PENDING';
COMMIT;

-- CreateTable
CREATE TABLE "public"."WalletAuthEvent" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "surface" TEXT,
    "chain" TEXT,
    "method" TEXT,
    "providerId" TEXT,
    "stage" TEXT,
    "walletAddressMasked" TEXT,
    "walletAddressHash" TEXT,
    "isNewWallet" BOOLEAN,
    "isRecovery" BOOLEAN,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "extra" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletAuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletAuthEvent_status_idx" ON "public"."WalletAuthEvent"("status");

-- CreateIndex
CREATE INDEX "WalletAuthEvent_channel_idx" ON "public"."WalletAuthEvent"("channel");

-- CreateIndex
CREATE INDEX "WalletAuthEvent_createdAt_idx" ON "public"."WalletAuthEvent"("createdAt");

-- CreateIndex
CREATE INDEX "WalletAuthEvent_walletAddressHash_idx" ON "public"."WalletAuthEvent"("walletAddressHash");

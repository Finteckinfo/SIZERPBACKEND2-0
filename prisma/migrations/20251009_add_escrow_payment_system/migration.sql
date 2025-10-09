-- Step 1: Add new columns to existing tables FIRST
ALTER TABLE "public"."Project" ADD COLUMN IF NOT EXISTS "allocatedFunds" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "public"."Project" ADD COLUMN IF NOT EXISTS "budgetAmount" DOUBLE PRECISION;
ALTER TABLE "public"."Project" ADD COLUMN IF NOT EXISTS "escrowAddress" TEXT;
ALTER TABLE "public"."Project" ADD COLUMN IF NOT EXISTS "escrowFunded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."Project" ADD COLUMN IF NOT EXISTS "releasedFunds" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Add Task payment columns with old enum first
ALTER TABLE "public"."Task" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "public"."Task" ADD COLUMN IF NOT EXISTS "paymentAmount" DOUBLE PRECISION;
ALTER TABLE "public"."Task" ADD COLUMN IF NOT EXISTS "paymentTxHash" TEXT;
ALTER TABLE "public"."Task" ADD COLUMN IF NOT EXISTS "paymentStatus" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING';

-- Step 2: Now alter the PaymentStatus enum
DO $$ 
BEGIN
    -- Add new enum values
    ALTER TYPE "public"."PaymentStatus" ADD VALUE IF NOT EXISTS 'ALLOCATED';
    ALTER TYPE "public"."PaymentStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
    ALTER TYPE "public"."PaymentStatus" ADD VALUE IF NOT EXISTS 'PAID';
    ALTER TYPE "public"."PaymentStatus" ADD VALUE IF NOT EXISTS 'FAILED';
    ALTER TYPE "public"."PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Step 3: Create new tables
CREATE TABLE IF NOT EXISTS "public"."ProjectEscrow" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "escrowAddress" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "initialDeposit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEscrow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."BlockchainTransaction" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "blockNumber" BIGINT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "errorMessage" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockchainTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."UserWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWallet_pkey" PRIMARY KEY ("id")
);

-- Step 4: Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectEscrow_projectId_key" ON "public"."ProjectEscrow"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectEscrow_escrowAddress_key" ON "public"."ProjectEscrow"("escrowAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "BlockchainTransaction_txHash_key" ON "public"."BlockchainTransaction"("txHash");
CREATE UNIQUE INDEX IF NOT EXISTS "BlockchainTransaction_taskId_key" ON "public"."BlockchainTransaction"("taskId");
CREATE INDEX IF NOT EXISTS "BlockchainTransaction_projectId_idx" ON "public"."BlockchainTransaction"("projectId");
CREATE INDEX IF NOT EXISTS "BlockchainTransaction_taskId_idx" ON "public"."BlockchainTransaction"("taskId");
CREATE INDEX IF NOT EXISTS "BlockchainTransaction_status_idx" ON "public"."BlockchainTransaction"("status");
CREATE INDEX IF NOT EXISTS "BlockchainTransaction_type_idx" ON "public"."BlockchainTransaction"("type");
CREATE INDEX IF NOT EXISTS "BlockchainTransaction_fromAddress_idx" ON "public"."BlockchainTransaction"("fromAddress");
CREATE INDEX IF NOT EXISTS "BlockchainTransaction_toAddress_idx" ON "public"."BlockchainTransaction"("toAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "UserWallet_userId_key" ON "public"."UserWallet"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserWallet_walletAddress_key" ON "public"."UserWallet"("walletAddress");
CREATE INDEX IF NOT EXISTS "Task_paymentStatus_idx" ON "public"."Task"("paymentStatus");

-- Step 5: Add foreign keys
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ProjectEscrow_projectId_fkey'
    ) THEN
        ALTER TABLE "public"."ProjectEscrow" ADD CONSTRAINT "ProjectEscrow_projectId_fkey" 
        FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BlockchainTransaction_projectId_fkey'
    ) THEN
        ALTER TABLE "public"."BlockchainTransaction" ADD CONSTRAINT "BlockchainTransaction_projectId_fkey" 
        FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BlockchainTransaction_taskId_fkey'
    ) THEN
        ALTER TABLE "public"."BlockchainTransaction" ADD CONSTRAINT "BlockchainTransaction_taskId_fkey" 
        FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;


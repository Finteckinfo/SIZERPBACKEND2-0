-- Add recurring payment fields to Project
ALTER TABLE "public"."Project" ADD COLUMN IF NOT EXISTS "minimumBalance" DOUBLE PRECISION;
ALTER TABLE "public"."Project" ADD COLUMN IF NOT EXISTS "fundingStrategy" TEXT;

-- Add payment terms to ProjectInvite
ALTER TABLE "public"."ProjectInvite" ADD COLUMN IF NOT EXISTS "paymentType" TEXT;
ALTER TABLE "public"."ProjectInvite" ADD COLUMN IF NOT EXISTS "salaryAmount" DOUBLE PRECISION;
ALTER TABLE "public"."ProjectInvite" ADD COLUMN IF NOT EXISTS "salaryFrequency" TEXT;
ALTER TABLE "public"."ProjectInvite" ADD COLUMN IF NOT EXISTS "oversightRate" DOUBLE PRECISION;

-- Create UserRolePayment table
CREATE TABLE IF NOT EXISTS "public"."UserRolePayment" (
    "id" TEXT NOT NULL,
    "userRoleId" TEXT NOT NULL,
    "paymentType" TEXT NOT NULL,
    "salaryAmount" DOUBLE PRECISION,
    "salaryFrequency" TEXT,
    "milestoneAmount" DOUBLE PRECISION,
    "milestoneId" TEXT,
    "oversightRate" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRolePayment_pkey" PRIMARY KEY ("id")
);

-- Create RecurringPayment table
CREATE TABLE IF NOT EXISTS "public"."RecurringPayment" (
    "id" TEXT NOT NULL,
    "userRoleId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "frequency" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextPaymentDate" TIMESTAMP(3) NOT NULL,
    "lastPaidDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "totalPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringPayment_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS "UserRolePayment_userRoleId_key" ON "public"."UserRolePayment"("userRoleId");
CREATE INDEX IF NOT EXISTS "UserRolePayment_userRoleId_idx" ON "public"."UserRolePayment"("userRoleId");
CREATE INDEX IF NOT EXISTS "UserRolePayment_paymentType_idx" ON "public"."UserRolePayment"("paymentType");
CREATE INDEX IF NOT EXISTS "RecurringPayment_projectId_idx" ON "public"."RecurringPayment"("projectId");
CREATE INDEX IF NOT EXISTS "RecurringPayment_userRoleId_idx" ON "public"."RecurringPayment"("userRoleId");
CREATE INDEX IF NOT EXISTS "RecurringPayment_nextPaymentDate_idx" ON "public"."RecurringPayment"("nextPaymentDate");
CREATE INDEX IF NOT EXISTS "RecurringPayment_status_idx" ON "public"."RecurringPayment"("status");

-- Add foreign keys
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserRolePayment_userRoleId_fkey'
    ) THEN
        ALTER TABLE "public"."UserRolePayment" ADD CONSTRAINT "UserRolePayment_userRoleId_fkey" 
        FOREIGN KEY ("userRoleId") REFERENCES "public"."UserRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'RecurringPayment_userRoleId_fkey'
    ) THEN
        ALTER TABLE "public"."RecurringPayment" ADD CONSTRAINT "RecurringPayment_userRoleId_fkey" 
        FOREIGN KEY ("userRoleId") REFERENCES "public"."UserRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'RecurringPayment_projectId_fkey'
    ) THEN
        ALTER TABLE "public"."RecurringPayment" ADD CONSTRAINT "RecurringPayment_projectId_fkey" 
        FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;


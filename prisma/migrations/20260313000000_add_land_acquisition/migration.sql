-- CreateEnum
CREATE TYPE "public"."LandRequestStatus" AS ENUM ('REQUEST_CREATED', 'PLOT_FOUND', 'PLOT_SELECTED', 'ESCROW_CREATED', 'ESCROW_FUNDED', 'DUE_DILIGENCE', 'EXECUTION', 'REGISTRY_TRANSFER', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."LandRequestStep" AS ENUM ('LOGIN', 'CONNECT_WALLET', 'CREATE_REQUEST', 'CONFIRMATION');

-- CreateTable
CREATE TABLE "public"."LandAcquisitionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT,
    "budget" DOUBLE PRECISION,
    "sizeCurve" TEXT,
    "purpose" TEXT,
    "plotReference" TEXT,
    "currentStep" "public"."LandRequestStep" NOT NULL DEFAULT 'LOGIN',
    "status" "public"."LandRequestStatus" NOT NULL DEFAULT 'REQUEST_CREATED',
    "selectedPlotId" TEXT,
    "escrowId" TEXT,
    "escrowAmount" DOUBLE PRECISION,
    "escrowFundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandAcquisitionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LandPlot" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullAddress" TEXT NOT NULL,
    "description" TEXT,
    "escrowAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandPlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LandPlotImage" (
    "id" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandPlotImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LandAcquisitionDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileHash" TEXT,
    "fileUrl" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandAcquisitionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LandAcquisitionRequest_userId_idx" ON "public"."LandAcquisitionRequest"("userId");

-- CreateIndex
CREATE INDEX "LandAcquisitionRequest_status_idx" ON "public"."LandAcquisitionRequest"("status");

-- CreateIndex
CREATE INDEX "LandAcquisitionRequest_createdAt_idx" ON "public"."LandAcquisitionRequest"("createdAt");

-- CreateIndex
CREATE INDEX "LandPlot_requestId_idx" ON "public"."LandPlot"("requestId");

-- CreateIndex
CREATE INDEX "LandPlotImage_plotId_idx" ON "public"."LandPlotImage"("plotId");

-- CreateIndex
CREATE INDEX "LandAcquisitionDocument_requestId_idx" ON "public"."LandAcquisitionDocument"("requestId");

-- AddForeignKey
ALTER TABLE "public"."LandAcquisitionRequest" ADD CONSTRAINT "LandAcquisitionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandAcquisitionRequest" ADD CONSTRAINT "LandAcquisitionRequest_selectedPlotId_fkey" FOREIGN KEY ("selectedPlotId") REFERENCES "public"."LandPlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandPlot" ADD CONSTRAINT "LandPlot_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."LandAcquisitionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandPlotImage" ADD CONSTRAINT "LandPlotImage_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "public"."LandPlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandAcquisitionDocument" ADD CONSTRAINT "LandAcquisitionDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."LandAcquisitionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "LandAcquisitionRequest" ADD COLUMN "legalFullName" TEXT;
ALTER TABLE "LandAcquisitionRequest" ADD COLUMN "legalIdType" TEXT;
ALTER TABLE "LandAcquisitionRequest" ADD COLUMN "legalIdNumber" TEXT;
ALTER TABLE "LandAcquisitionRequest" ADD COLUMN "nationality" TEXT;
ALTER TABLE "LandAcquisitionRequest" ADD COLUMN "registryRef" TEXT;
ALTER TABLE "LandAcquisitionRequest" ADD COLUMN "courierTracking" TEXT;

-- AlterTable
ALTER TABLE "LandListing" ADD COLUMN "satelliteStatus" TEXT;
ALTER TABLE "LandListing" ADD COLUMN "satelliteNotes" TEXT;
ALTER TABLE "LandListing" ADD COLUMN "satelliteVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LandFile" (
    "id" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "listingId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LandFile_listingId_idx" ON "LandFile"("listingId");
CREATE INDEX "LandFile_requestId_idx" ON "LandFile"("requestId");

ALTER TABLE "LandFile"
  ADD CONSTRAINT "LandFile_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "LandListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LandFile"
  ADD CONSTRAINT "LandFile_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LandAcquisitionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LandDiligenceItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandDiligenceItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LandDiligenceItem_requestId_key_key" ON "LandDiligenceItem"("requestId", "key");
CREATE INDEX "LandDiligenceItem_requestId_idx" ON "LandDiligenceItem"("requestId");

ALTER TABLE "LandDiligenceItem"
  ADD CONSTRAINT "LandDiligenceItem_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LandAcquisitionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LandMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LandMessage_requestId_createdAt_idx" ON "LandMessage"("requestId", "createdAt");

ALTER TABLE "LandMessage"
  ADD CONSTRAINT "LandMessage_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LandAcquisitionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LandAuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LandAuditEvent_createdAt_idx" ON "LandAuditEvent"("createdAt");
CREATE INDEX "LandAuditEvent_entityType_entityId_idx" ON "LandAuditEvent"("entityType", "entityId");

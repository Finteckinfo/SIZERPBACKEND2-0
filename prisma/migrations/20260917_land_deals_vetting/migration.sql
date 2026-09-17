-- CreateEnum
CREATE TYPE "ListingKind" AS ENUM ('LAND', 'COMMODITY');

-- AlterEnum
ALTER TYPE "LandListingStatus" ADD VALUE 'PENDING_VETTING';
ALTER TYPE "LandListingStatus" ADD VALUE 'REJECTED';
ALTER TYPE "LandListingStatus" ADD VALUE 'RESERVED';
ALTER TYPE "LandListingStatus" ADD VALUE 'SOLD';

-- AlterTable
ALTER TABLE "LandListing" ADD COLUMN "kind" "ListingKind" NOT NULL DEFAULT 'LAND';
ALTER TABLE "LandListing" ADD COLUMN "region" TEXT;
ALTER TABLE "LandListing" ADD COLUMN "badges" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LandListing" ADD COLUMN "media" JSONB;
ALTER TABLE "LandListing" ADD COLUMN "satelliteSceneDate" TIMESTAMP(3);
ALTER TABLE "LandListing" ADD COLUMN "submittedByUserId" TEXT;
ALTER TABLE "LandListing" ADD COLUMN "rejectionReason" TEXT;

CREATE INDEX "LandListing_submittedByUserId_idx" ON "LandListing"("submittedByUserId");

ALTER TABLE "LandListing"
  ADD CONSTRAINT "LandListing_submittedByUserId_fkey"
  FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LandAcquisitionRequest" ADD COLUMN "listingId" TEXT;

CREATE INDEX "LandAcquisitionRequest_listingId_idx" ON "LandAcquisitionRequest"("listingId");

ALTER TABLE "LandAcquisitionRequest"
  ADD CONSTRAINT "LandAcquisitionRequest_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "LandListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LandNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LandNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LandNotification_userId_read_idx" ON "LandNotification"("userId", "read");

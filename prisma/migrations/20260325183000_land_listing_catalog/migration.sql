-- CreateEnum
CREATE TYPE "public"."LandListingStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "public"."LandListing" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fullAddress" TEXT NOT NULL,
    "listPrice" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'USD',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "boundaryGeoJSON" JSONB,
    "status" "public"."LandListingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandListing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LandListing_status_idx" ON "public"."LandListing"("status");

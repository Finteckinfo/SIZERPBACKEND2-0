-- Align DB with Prisma schema: land admin flag, plot geodata, satellite verification.
-- Without these, admin list (include satelliteVerification) and requireLandAdmin (isLandAdmin) fail at runtime.

-- User: land acquisition admin bootstrap / DB flag
ALTER TABLE "public"."User" ADD COLUMN IF NOT EXISTS "isLandAdmin" BOOLEAN NOT NULL DEFAULT false;

-- LandPlot: CASSINI / geospatial fields
ALTER TABLE "public"."LandPlot" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "public"."LandPlot" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "public"."LandPlot" ADD COLUMN IF NOT EXISTS "boundaryGeoJSON" JSONB;

-- SatelliteVerification (optional 1:1 per plot)
CREATE TABLE IF NOT EXISTS "public"."SatelliteVerification" (
    "id" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "lastImageryDate" TIMESTAMP(3),
    "changeDetectionStatus" TEXT,
    "hasVerified" BOOLEAN NOT NULL DEFAULT false,
    "osnmaProofHash" TEXT,
    "imageryUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SatelliteVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SatelliteVerification_plotId_key" ON "public"."SatelliteVerification"("plotId");
CREATE INDEX IF NOT EXISTS "SatelliteVerification_plotId_idx" ON "public"."SatelliteVerification"("plotId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SatelliteVerification_plotId_fkey'
  ) THEN
    ALTER TABLE "public"."SatelliteVerification"
      ADD CONSTRAINT "SatelliteVerification_plotId_fkey"
      FOREIGN KEY ("plotId") REFERENCES "public"."LandPlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

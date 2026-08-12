-- Additive: contact fields for buy.siz.land Create Request follow-up
ALTER TABLE "LandAcquisitionRequest" ADD COLUMN IF NOT EXISTS "contactName" TEXT;
ALTER TABLE "LandAcquisitionRequest" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
CREATE INDEX IF NOT EXISTS "LandAcquisitionRequest_contactEmail_idx" ON "LandAcquisitionRequest"("contactEmail");

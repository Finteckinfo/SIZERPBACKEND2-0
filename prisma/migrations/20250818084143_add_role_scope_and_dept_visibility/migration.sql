-- AlterTable
ALTER TABLE "public"."Department" ADD COLUMN     "isVisible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."UserRole" ADD COLUMN     "departmentOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "departmentScope" TEXT[] DEFAULT ARRAY[]::TEXT[];

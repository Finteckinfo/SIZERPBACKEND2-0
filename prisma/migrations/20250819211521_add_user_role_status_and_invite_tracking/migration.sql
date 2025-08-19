/*
  Warnings:

  - Added the required column `updatedAt` to the `UserRole` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."UserRoleStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "public"."Task" ADD COLUMN     "priority" "public"."Priority" NOT NULL DEFAULT 'MEDIUM';

-- AlterTable
ALTER TABLE "public"."UserRole" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "inviteId" TEXT,
ADD COLUMN     "status" "public"."UserRoleStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."UserRole" ADD CONSTRAINT "UserRole_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "public"."ProjectInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

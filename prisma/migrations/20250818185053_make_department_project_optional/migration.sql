/*
  Warnings:

  - A unique constraint covering the columns `[name,projectId]` on the table `Department` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "public"."Department" DROP CONSTRAINT "Department_projectId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Task" DROP CONSTRAINT "Task_departmentId_fkey";

-- AlterTable
ALTER TABLE "public"."Department" ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."Task" ALTER COLUMN "departmentId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_projectId_key" ON "public"."Department"("name", "projectId");

-- AddForeignKey
ALTER TABLE "public"."Department" ADD CONSTRAINT "Department_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

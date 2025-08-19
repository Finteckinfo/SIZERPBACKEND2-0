/*
  Warnings:

  - You are about to drop the column `managerId` on the `Department` table. All the data in the column will be lost.
  - Made the column `projectId` on table `Department` required. This step will fail if there are existing NULL values in that column.
  - Made the column `departmentId` on table `Task` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "public"."Department" DROP CONSTRAINT "Department_managerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Department" DROP CONSTRAINT "Department_projectId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Task" DROP CONSTRAINT "Task_departmentId_fkey";

-- AlterTable
ALTER TABLE "public"."Department" DROP COLUMN "managerId",
ALTER COLUMN "projectId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."Task" ADD COLUMN     "assignedRoleId" TEXT,
ALTER COLUMN "departmentId" SET NOT NULL;

-- CreateTable
CREATE TABLE "public"."_DepartmentManagers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DepartmentManagers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_DepartmentAccess" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DepartmentAccess_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_DepartmentManagers_B_index" ON "public"."_DepartmentManagers"("B");

-- CreateIndex
CREATE INDEX "_DepartmentAccess_B_index" ON "public"."_DepartmentAccess"("B");

-- AddForeignKey
ALTER TABLE "public"."Department" ADD CONSTRAINT "Department_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_assignedRoleId_fkey" FOREIGN KEY ("assignedRoleId") REFERENCES "public"."UserRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_DepartmentManagers" ADD CONSTRAINT "_DepartmentManagers_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_DepartmentManagers" ADD CONSTRAINT "_DepartmentManagers_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."UserRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_DepartmentAccess" ADD CONSTRAINT "_DepartmentAccess_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_DepartmentAccess" ADD CONSTRAINT "_DepartmentAccess_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."UserRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

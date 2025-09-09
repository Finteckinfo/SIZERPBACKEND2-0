-- AlterTable
ALTER TABLE "public"."Department" ADD COLUMN     "color" TEXT;

-- AlterTable
ALTER TABLE "public"."Project" ADD COLUMN     "color" TEXT;

-- AlterTable
ALTER TABLE "public"."Task" ADD COLUMN     "checklistCompleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "checklistCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createdByRoleId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "isAllDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "timeZone" TEXT;

-- CreateIndex
CREATE INDEX "Task_departmentId_idx" ON "public"."Task"("departmentId");

-- CreateIndex
CREATE INDEX "Task_assignedRoleId_idx" ON "public"."Task"("assignedRoleId");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "public"."Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_startDate_idx" ON "public"."Task"("startDate");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "public"."Task"("status");

-- CreateIndex
CREATE INDEX "Task_priority_idx" ON "public"."Task"("priority");

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_createdByRoleId_fkey" FOREIGN KEY ("createdByRoleId") REFERENCES "public"."UserRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

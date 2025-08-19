/*
  Warnings:

  - You are about to drop the `ProjectDraft` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectTemplate` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."ProjectDraft" DROP CONSTRAINT "ProjectDraft_projectId_fkey";

-- DropTable
DROP TABLE "public"."ProjectDraft";

-- DropTable
DROP TABLE "public"."ProjectTemplate";

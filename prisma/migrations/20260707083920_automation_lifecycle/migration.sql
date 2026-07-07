/*
  Warnings:

  - You are about to drop the column `liveDeletesApproved` on the `deletion_schedules` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[approveToken]` on the table `deletion_schedules` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING_DRY_RUN', 'AWAITING_APPROVAL', 'APPROVED', 'DISABLED');

-- AlterTable
ALTER TABLE "deletion_runs" ADD COLUMN     "scheduledExecutionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "deletion_schedules" DROP COLUMN "liveDeletesApproved",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING_DRY_RUN',
ADD COLUMN     "approveToken" TEXT,
ADD COLUMN     "approveTokenExpiresAt" TIMESTAMP(3),
ALTER COLUMN "isEnabled" SET DEFAULT true;

-- CreateIndex
CREATE INDEX "deletion_runs_status_scheduledExecutionAt_idx" ON "deletion_runs"("status", "scheduledExecutionAt");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_schedules_approveToken_key" ON "deletion_schedules"("approveToken");

-- CreateIndex
CREATE INDEX "deletion_schedules_approvalStatus_isEnabled_idx" ON "deletion_schedules"("approvalStatus", "isEnabled");

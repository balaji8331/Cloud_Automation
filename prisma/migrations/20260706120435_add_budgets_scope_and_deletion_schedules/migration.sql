-- CreateEnum
CREATE TYPE "BudgetScope" AS ENUM ('TENANT', 'SUBSCRIPTION', 'RESOURCE_GROUP');

-- CreateEnum
CREATE TYPE "BudgetSource" AS ENUM ('PORTAL', 'AZURE_NATIVE');

-- CreateEnum
CREATE TYPE "DeletionScopeType" AS ENUM ('RESOURCE_GROUP', 'SUBSCRIPTION', 'MULTIPLE_RESOURCE_GROUPS');

-- CreateEnum
CREATE TYPE "DeletionRunStatus" AS ENUM ('DRY_RUN', 'NOTIFIED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "azurePortalUrl" TEXT,
ADD COLUMN     "scopeId" TEXT,
ADD COLUMN     "scopeType" "BudgetScope" NOT NULL DEFAULT 'TENANT',
ADD COLUMN     "source" "BudgetSource" NOT NULL DEFAULT 'PORTAL';

-- CreateTable
CREATE TABLE "deletion_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeType" "DeletionScopeType" NOT NULL,
    "targetIds" JSONB NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "liveDeletesApproved" BOOLEAN NOT NULL DEFAULT false,
    "excludeTagKey" TEXT NOT NULL DEFAULT 'donotdelete',
    "notifyBeforeMinutes" INTEGER NOT NULL DEFAULT 60,
    "notifyEmails" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deletion_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_runs" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "status" "DeletionRunStatus" NOT NULL DEFAULT 'DRY_RUN',
    "plannedResources" JSONB,
    "deletedResources" JSONB,
    "failedResources" JSONB,
    "skippedResources" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelToken" TEXT,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "deletion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deletion_schedules_tenantId_idx" ON "deletion_schedules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_runs_cancelToken_key" ON "deletion_runs"("cancelToken");

-- CreateIndex
CREATE INDEX "deletion_runs_scheduleId_startedAt_idx" ON "deletion_runs"("scheduleId", "startedAt");

-- AddForeignKey
ALTER TABLE "deletion_schedules" ADD CONSTRAINT "deletion_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_schedules" ADD CONSTRAINT "deletion_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_runs" ADD CONSTRAINT "deletion_runs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "deletion_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

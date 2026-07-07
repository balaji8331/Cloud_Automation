-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('COST_INGESTION', 'RESOURCE_SYNC', 'DELETION_EXECUTION', 'ANOMALY_DETECTION', 'BUDGET_ALERT_CHECK');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('SCHEDULED', 'IMMEDIATE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "job_queue" (
    "id" TEXT NOT NULL,
    "job_type" "JobType" NOT NULL,
    "tenant_id" TEXT,
    "reference_id" TEXT,
    "payload" JSONB,
    "priority" "JobPriority" NOT NULL DEFAULT 'SCHEDULED',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error_message" TEXT,
    "created_by" TEXT,
    "scheduled_for" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_queue_status_scheduled_for_priority_idx" ON "job_queue"("status", "scheduled_for", "priority");

-- CreateIndex
CREATE INDEX "job_queue_tenant_id_status_idx" ON "job_queue"("tenant_id", "status");

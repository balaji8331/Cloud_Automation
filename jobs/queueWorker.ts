import prisma from "@/lib/db";
import { runTenantOperation } from "@/lib/azure/tenantQueue";
import { JobType, JobStatus, JobPriority } from "@prisma/client";

// Import job handlers (to be refactored)
import { ingestTenant } from "./ingest";
import { syncAllTenantsResources, syncTenantResources } from "./syncResources";
import { executeScheduleRun } from "./deletionExecutor";
import { detectAnomalies } from "./anomaly";
import { checkBudgetAlerts } from "./budgetAlerts";

const POLL_INTERVAL_MS = 5000;
let isPolling = false;
let timeoutId: NodeJS.Timeout | null = null;

async function processJob(job: any) {
  await prisma.jobQueue.update({
    where: { id: job.id },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });

  try {
    const runJob = async () => {
      switch (job.jobType) {
        case JobType.COST_INGESTION:
          if (!job.tenantId) throw new Error("COST_INGESTION requires tenantId");
          // Currently ingestTenant takes (tenantId, days). Payload can supply days.
          const days = job.payload?.days ?? 30;
          await ingestTenant(job.tenantId, days);
          break;

        case JobType.RESOURCE_SYNC:
          if (job.tenantId) {
             await syncTenantResources(job.tenantId);
          } else {
            await syncAllTenantsResources();
          }
          break;

        case JobType.DELETION_EXECUTION:
          if (!job.referenceId) throw new Error("DELETION_EXECUTION requires referenceId");
          await executeScheduleRun(job.referenceId);
          break;

        case JobType.ANOMALY_DETECTION:
          await detectAnomalies();
          break;

        case JobType.BUDGET_ALERT_CHECK:
          await checkBudgetAlerts();
          break;

        default:
          throw new Error(`Unknown job type: ${job.jobType}`);
      }
    };

    // If tenant-scoped, use the tenant mutex
    if (job.tenantId) {
      // Don't reject if busy, just queue it in the mutex
      await runTenantOperation(job.tenantId, `job:${job.jobType}`, runJob);
    } else {
      await runJob();
    }

    await prisma.jobQueue.update({
      where: { id: job.id },
      data: { status: JobStatus.COMPLETED, completedAt: new Date() },
    });
  } catch (err: any) {
    console.error(`[JobWorker] Job ${job.id} failed:`, err);
    
    const attempts = job.attempts + 1;
    if (attempts < job.maxAttempts) {
      // Retry with backoff
      const backoffMs = Math.pow(2, attempts) * 60000; // 2m, 4m, 8m
      await prisma.jobQueue.update({
        where: { id: job.id },
        data: { 
          status: JobStatus.PENDING, 
          attempts, 
          errorMessage: err.message,
          scheduledFor: new Date(Date.now() + backoffMs)
        },
      });
    } else {
      await prisma.jobQueue.update({
        where: { id: job.id },
        data: { 
          status: JobStatus.FAILED, 
          attempts, 
          errorMessage: err.message,
          completedAt: new Date()
        },
      });
      // Optionally log to audit_log here
    }
  }
}

async function poll() {
  try {
    // Find pending jobs
    const jobs = await prisma.jobQueue.findMany({
      where: {
        status: JobStatus.PENDING,
        scheduledFor: { lte: new Date() }
      },
      orderBy: [
        { priority: 'asc' }, // IMMEDIATE is typically listed after SCHEDULED if alphabetical, but in Prisma enums it depends. Let's fix this in sorting.
        { createdAt: 'asc' }
      ],
      take: 10
    });

    // In Prisma, enum sorting uses the order defined in the schema.
    // Our schema has: SCHEDULED, IMMEDIATE. So 'asc' means SCHEDULED first.
    // Wait, we want IMMEDIATE first. So we should sort 'desc'.
    jobs.sort((a, b) => {
      if (a.priority === b.priority) return a.createdAt.getTime() - b.createdAt.getTime();
      return a.priority === JobPriority.IMMEDIATE ? -1 : 1;
    });

    for (const job of jobs) {
      // We don't await processJob here so we can process multiple concurrently
      // The tenant mutex will handle concurrency per-tenant
      processJob(job).catch(console.error);
    }
  } catch (err) {
    console.error("[JobWorker] Polling error:", err);
  } finally {
    timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
  }
}

export function startWorker() {
  if (isPolling) return;
  isPolling = true;
  console.log("[JobWorker] Starting job queue worker");
  poll();
}

export function stopWorker() {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  isPolling = false;
}

/**
 * Daily scheduler — runs at 02:00 UTC via node-cron.
 * Also starts the unified job queue worker.
 * Import this file in a custom Next.js server (server.ts) or a standalone Node process.
 *
 * Usage: import "@/jobs/scheduler" in your server entry point.
 */
import cron from "node-cron";
import prisma from "@/lib/db";
import { JobType, JobPriority } from "@prisma/client";
import { startWorker } from "./queueWorker";
import { startAutomationPoller } from "./automationPoller";
import { startScriptPoller } from "./scriptPoller";

// Daily at 02:00 UTC
const CRON_SCHEDULE = process.env.INGEST_CRON ?? "0 2 * * *";

let scheduled = false;
const SCHEDULER_STARTED_KEY = Symbol.for("scheduler.started");

export function startScheduler(): void {
  const g = global as typeof global & { [key: symbol]: boolean };
  if (g[SCHEDULER_STARTED_KEY]) {
    console.log("[Scheduler] Already running — skipping duplicate start");
    return;
  }
  g[SCHEDULER_STARTED_KEY] = true;
  scheduled = true;

  // Start the unified queue worker
  startWorker();

  cron.schedule(CRON_SCHEDULE, async () => {
    console.log(`[Scheduler] Queueing daily jobs — ${new Date().toISOString()}`);

    try {
      const tenants = await prisma.tenant.findMany({ select: { id: true } });

      // 1. Enqueue COST_INGESTION per tenant
      for (const t of tenants) {
        await prisma.jobQueue.create({
          data: {
            jobType: JobType.COST_INGESTION,
            tenantId: t.id,
            priority: JobPriority.SCHEDULED,
            payload: { days: 30 }
          }
        });
      }

      // 2. Enqueue BUDGET_ALERT_CHECK
      await prisma.jobQueue.create({
        data: {
          jobType: JobType.BUDGET_ALERT_CHECK,
          priority: JobPriority.SCHEDULED,
        }
      });

      // 3. Enqueue ANOMALY_DETECTION
      await prisma.jobQueue.create({
        data: {
          jobType: JobType.ANOMALY_DETECTION,
          priority: JobPriority.SCHEDULED,
        }
      });

      // 4. Enqueue RESOURCE_SYNC (global)
      await prisma.jobQueue.create({
        data: {
          jobType: JobType.RESOURCE_SYNC,
          priority: JobPriority.SCHEDULED,
        }
      });

      console.log(`[Scheduler] Daily jobs successfully queued.`);
    } catch (err) {
      console.error("[Scheduler] Failed to queue daily jobs:", err);
    }
  });

  console.log(`[Scheduler] Daily ingestion scheduled: ${CRON_SCHEDULE}`);

  // Start the automation lifecycle poller (dry runs, notifications, executions)
  startAutomationPoller();
  
  // Start the scheduled script poller
  startScriptPoller();
}

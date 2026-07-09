import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import prisma from "@/lib/db";
import { JobType, JobPriority } from "@prisma/client";

let pollerStarted = false;
const POLLER_STARTED_KEY = Symbol.for("scriptPoller.started");

export function startScriptPoller(): void {
  const g = global as typeof global & { [key: symbol]: boolean };
  if (g[POLLER_STARTED_KEY]) {
    console.log("[ScriptPoller] Already running — skipping duplicate start");
    return;
  }
  g[POLLER_STARTED_KEY] = true;
  pollerStarted = true;

  // Run every minute
  cron.schedule("* * * * *", () => {
    runPollCycle().catch((e) => console.error("[ScriptPoller] Unhandled error:", e));
  }, { timezone: "UTC" });

  console.log("[ScriptPoller] Started — polling every 60s");
}

async function runPollCycle(): Promise<void> {
  const now = new Date();

  const dueSchedules = await prisma.scriptSchedule.findMany({
    where: { 
      isEnabled: true, 
      nextRunAt: { lte: now } 
    },
  });

  for (const schedule of dueSchedules) {
    console.log(`[ScriptPoller] Triggering scheduled script: ${schedule.name}`);

    // Calculate next run immediately to prevent double-triggering
    let nextRunAt: Date | null = null;
    try {
      const crons = schedule.cronExpression.split("\n").filter(Boolean);
      let earliestNext: Date | null = null;

      for (const cronStr of crons) {
        const interval = CronExpressionParser.parse(cronStr, { tz: "UTC" });
        const nextDate = interval.next().toDate();
        if (!earliestNext || nextDate < earliestNext) {
          earliestNext = nextDate;
        }
      }
      nextRunAt = earliestNext;
    } catch (err) {
      console.error(`[ScriptPoller] Invalid cron expression for schedule ${schedule.id}:`, err);
      // Disable the schedule if the cron is invalid
      await prisma.scriptSchedule.update({
        where: { id: schedule.id },
        data: { isEnabled: false }
      });
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // 1. Create the ScriptRun
      const scriptRun = await tx.scriptRun.create({
        data: {
          tenantId: schedule.tenantId,
          subscriptionId: schedule.subscriptionId,
          targetResourceGroup: schedule.targetResourceGroup,
          name: schedule.name,
          scriptType: schedule.scriptType,
          scriptContent: schedule.scriptContent,
          triggeredById: schedule.createdById, // Using the creator as the trigger
          scheduleId: schedule.id,
          status: "running"
        }
      });

      // 2. Add to JobQueue
      await tx.jobQueue.create({
        data: {
          jobType: JobType.SCRIPT_EXECUTION,
          tenantId: schedule.tenantId,
          referenceId: scriptRun.id,
          priority: JobPriority.SCHEDULED,
        }
      });

      // 3. Update the schedule's lastRunAt and nextRunAt
      await tx.scriptSchedule.update({
        where: { id: schedule.id },
        data: { 
          lastRunAt: now,
          nextRunAt 
        }
      });
    });
  }
}

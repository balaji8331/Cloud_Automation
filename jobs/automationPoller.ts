/**
 * Automation Poller — drives the full deletion schedule lifecycle automatically.
 * Runs every 60 seconds. No manual clicks needed after initial Approve.
 *
 * Lifecycle handled here:
 *   PENDING_DRY_RUN  → trigger dry run → send email → set AWAITING_APPROVAL
 *   APPROVED         → at (cron_time - notify_before_minutes): send pre-execution email,
 *                       create DeletionRun(status=NOTIFIED, scheduledExecutionAt=cron_time)
 *   NOTIFIED run     → at scheduledExecutionAt: execute the deletion
 */
import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import prisma from "@/lib/db";
import { ApprovalStatus } from "@prisma/client";
import { executeDryRun, executeLiveRun } from "./deletionExecutor";
import { sendEmail } from "@/lib/email";
import { randomBytes } from "crypto";

let pollerStarted = false;
// Use a global symbol so hot-reload doesn't reset the guard
const POLLER_STARTED_KEY = Symbol.for("automationPoller.started");

export function startAutomationPoller(): void {
  // Use a global symbol guard so Next.js hot-reload doesn't start duplicate pollers
  const g = global as typeof global & { [key: symbol]: boolean };
  if (g[POLLER_STARTED_KEY]) {
    console.log("[AutomationPoller] Already running — skipping duplicate start");
    return;
  }
  g[POLLER_STARTED_KEY] = true;
  pollerStarted = true;

  // Run every minute
  cron.schedule("* * * * *", () => {
    runPollCycle().catch((e) => console.error("[AutomationPoller] Unhandled error:", e));
  }, { timezone: "UTC" });

  console.log("[AutomationPoller] Started — polling every 60s");

  // Run immediately on startup — don't wait 60s for first tick
  setImmediate(() => {
    runPollCycle().catch((e) => console.error("[AutomationPoller] Initial poll error:", e));
  });
}

async function runPollCycle(): Promise<void> {
  const now = new Date();
  console.log(`[AutomationPoller] Poll cycle at ${now.toISOString()}`);

  // ── 1. PENDING_DRY_RUN schedules — trigger dry run automatically ──────────
  const pendingDryRun = await prisma.deletionSchedule.findMany({
    where: { approvalStatus: ApprovalStatus.PENDING_DRY_RUN, isEnabled: true },
    include: { tenant: true, createdBy: { select: { email: true } } },
    // updatedAt is always included automatically — used below to filter fresh runs
  });

  for (const schedule of pendingDryRun) {
    // Guard: only trigger if no DRY_RUN run exists that was created AFTER the last
    // status reset (updatedAt). This prevents re-triggering on historical runs
    // and handles the PATCH → re-dry-run cycle correctly.
    const resetTime = schedule.updatedAt;

    const existingRun = await prisma.deletionRun.findFirst({
      where: {
        scheduleId: schedule.id,
        status: "DRY_RUN",
        startedAt: { gte: new Date(resetTime.getTime() - 5000) }, // 5s buffer for clock drift
      },
    });
    if (existingRun) {
      // Fresh dry run already completed — advance to AWAITING_APPROVAL
      await prisma.deletionSchedule.update({
        where: { id: schedule.id },
        data: { approvalStatus: ApprovalStatus.AWAITING_APPROVAL },
      });
      continue;
    }

    // Guard against a dry run currently in-flight
    const inFlight = await prisma.deletionRun.findFirst({
      where: { scheduleId: schedule.id, status: "DRY_RUN", completedAt: null },
    });
    if (inFlight) continue;

    console.log(`[AutomationPoller] Triggering automatic dry run for schedule "${schedule.name}"`);

    // Mark as in-progress by setting a transient flag — prevents double-trigger
    // between poller cycles while the async dry run is executing
    await prisma.deletionSchedule.update({
      where: { id: schedule.id },
      // Bump updatedAt so next poll cycle's guard sees this trigger time
      data: { updatedAt: new Date() },
    });

    executeDryRun(schedule.id)
      .then(async () => {
        await prisma.deletionSchedule.update({
          where: { id: schedule.id },
          data: { approvalStatus: ApprovalStatus.AWAITING_APPROVAL },
        });
        console.log(`[AutomationPoller] Dry run complete for "${schedule.name}" — status → AWAITING_APPROVAL`);
      })
      .catch((e) => {
        console.error(`[AutomationPoller] Dry run failed for schedule ${schedule.id}:`, e);
        // Reset to PENDING_DRY_RUN so it retries on the next cycle
        prisma.deletionSchedule.update({
          where: { id: schedule.id },
          data: { approvalStatus: ApprovalStatus.PENDING_DRY_RUN },
        }).catch(() => {});
      });
  }

  // ── 2. APPROVED schedules — check if it's time to send pre-execution notification ──
  const approved = await prisma.deletionSchedule.findMany({
    where: { approvalStatus: ApprovalStatus.APPROVED, isEnabled: true },
    include: { tenant: { select: { name: true } } },
  });

  for (const schedule of approved) {
    const cronTimes = getCronTimes(schedule.cronExpression);
    if (!cronTimes.length) {
      console.warn(`[AutomationPoller] Invalid cron for schedule "${schedule.name}": ${schedule.cronExpression}`);
      continue;
    }

    // Build the list of candidate execution times to check:
    // - the previous occurrence (if within grace window — handles "just missed" cases)
    // - the next occurrence (future)
    const candidates: Date[] = [];
    for (const { next, prev } of cronTimes) {
      candidates.push(next);
      if (prev && now.getTime() - prev.getTime() <= EXEC_GRACE_MS) {
        candidates.push(prev);
      }
    }

    let actionTaken = false;
    for (const execTime of candidates) {
      const notifyAt = new Date(execTime.getTime() - schedule.notifyBeforeMinutes * 60 * 1000);

      // Not time to notify yet for this occurrence
      if (now < notifyAt) {
        console.log(`[AutomationPoller] "${schedule.name}" — next notify at ${notifyAt.toISOString()}, exec at ${execTime.toISOString()}`);
        continue;
      }

      // Already past the grace window for this occurrence (too late to notify/execute)
      if (now.getTime() > execTime.getTime() + EXEC_GRACE_MS) continue;

      // Already have a NOTIFIED/EXECUTING/COMPLETED/FAILED run for this execution window?
      const existingRun = await prisma.deletionRun.findFirst({
        where: {
          scheduleId: schedule.id,
          status: { in: ["NOTIFIED", "EXECUTING", "COMPLETED", "FAILED"] },
          scheduledExecutionAt: {
            gte: new Date(execTime.getTime() - EXEC_GRACE_MS),
            lte: new Date(execTime.getTime() + EXEC_GRACE_MS),
          },
        },
      });
      if (existingRun) continue;

      console.log(`[AutomationPoller] Sending pre-execution notification for "${schedule.name}" (executes at ${execTime.toISOString()})`);

      const cancelToken = randomBytes(16).toString("hex");
      const run = await prisma.deletionRun.create({
        data: {
          scheduleId: schedule.id,
          status: "NOTIFIED",
          cancelToken,
          notifiedAt: now,
          scheduledExecutionAt: execTime,
        },
      });

      const cancelUrl = `${process.env.NEXTAUTH_URL}/api/automation/cancel?token=${cancelToken}`;
      await sendEmail({
        to: getNotifyEmails(schedule.notifyEmails),
        subject: `⚠️ Upcoming deletion: "${schedule.name}" — executes at ${formatIST(execTime)}`,
        html: preExecutionEmailHtml({
          scheduleName: schedule.name,
          tenantName: schedule.tenant.name,
          notifyBeforeMinutes: schedule.notifyBeforeMinutes,
          execTime,
          cancelUrl,
          runId: run.id,
        }),
      }).catch((e) => console.error(`[AutomationPoller] Failed to send notification email for ${schedule.id}:`, e));

      // If execTime is already past (grace window), create NOTIFIED then immediately check
      // for execution in the same cycle — the step 3 loop below will pick it up
      if (now >= execTime) {
        console.log(`[AutomationPoller] Exec time already passed for "${schedule.name}" — will execute immediately in this cycle`);
      }
      actionTaken = true;
    }

    if (!actionTaken) {
      // All candidates either not due yet or already handled — log for visibility
      const nextExec = candidates[0];
      if (nextExec) {
        const minsUntil = Math.round((nextExec.getTime() - now.getTime()) / 60000);
        console.log(`[AutomationPoller] "${schedule.name}" APPROVED — next execution in ${minsUntil}min`);
      }
    }
  }

  // ── 3. NOTIFIED runs — check if execution time has arrived ───────────────
  const notifiedRuns = await prisma.deletionRun.findMany({
    where: {
      status: "NOTIFIED",
      scheduledExecutionAt: { lte: now },
    },
    include: {
      schedule: {
        select: {
          id: true, name: true, isEnabled: true, approvalStatus: true,
        },
      },
    },
  });

  for (const run of notifiedRuns) {
    if (!run.schedule.isEnabled || run.schedule.approvalStatus !== ApprovalStatus.APPROVED) {
      // Schedule was disabled or de-approved after notification was sent — cancel the run
      await prisma.deletionRun.update({
        where: { id: run.id },
        data: { status: "CANCELLED", completedAt: now, cancelledBy: "system" },
      });
      console.log(`[AutomationPoller] Auto-cancelled run ${run.id} — schedule disabled or de-approved`);
      continue;
    }

    console.log(`[AutomationPoller] Executing live run ${run.id} for schedule "${run.schedule.name}"`);
    // Fire async — don't block
    executeLiveRun(run.schedule.id, run.id)
      .catch((e) => console.error(`[AutomationPoller] Live run ${run.id} failed:`, e));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the next AND previous scheduled execution times for a cron expression.
 * We check both so we don't miss an occurrence that just passed (within grace window).
 */
function getCronTimes(cronExpression: string): { next: Date; prev: Date | null }[] {
  const lines = cronExpression.split("\n").filter(Boolean);
  const results: { next: Date; prev: Date | null }[] = [];

  for (const line of lines) {
    try {
      const interval = CronExpressionParser.parse(line, { tz: "UTC" });
      const next = interval.next().toDate();

      // Get previous occurrence by parsing with currentDate slightly before now
      let prev: Date | null = null;
      try {
        const prevInterval = CronExpressionParser.parse(line, { tz: "UTC" });
        prev = prevInterval.prev().toDate();
      } catch { /* prev unavailable */ }

      results.push({ next, prev });
    } catch {
      // Invalid cron line — skip
    }
  }
  return results;
}

// How long after the scheduled exec time we still treat the window as valid
// (handles cases where the poller was delayed or approval happened right before exec time)
const EXEC_GRACE_MS = 5 * 60 * 1000; // 5 minutes

function getNotifyEmails(override: string): string {
  const base = process.env.ALERT_TO_EMAIL ?? "";
  const addresses = override?.trim()
    ? override.split(",").map((e) => e.trim()).filter(Boolean)
    : base.split(",").map((e) => e.trim()).filter(Boolean);
  return addresses.join(",") || base;
}

function formatIST(date: Date): string {
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short", year: "numeric", month: "short",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }) + " IST";
}

function preExecutionEmailHtml(p: {
  scheduleName: string;
  tenantName: string;
  notifyBeforeMinutes: number;
  execTime: Date;
  cancelUrl: string;
  runId: string;
}): string {
  return `<div style="font-family:sans-serif;max-width:700px">
    <h2 style="color:#ef4444">⚠️ Upcoming Deletion: "${p.scheduleName}"</h2>
    <p>Tenant: <strong>${p.tenantName}</strong></p>
    <p>Resources will be automatically deleted at <strong>${formatIST(p.execTime)}</strong>
       (in approximately ${p.notifyBeforeMinutes} minute${p.notifyBeforeMinutes !== 1 ? "s" : ""}).</p>
    <p>This deletion will proceed automatically unless cancelled below.</p>
    <a href="${p.cancelUrl}" style="display:inline-block;background:#dc2626;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:16px">Cancel This Run</a>
    <p style="color:#6b7280;font-size:12px;margin-top:8px">Cancel link valid until execution starts. Run ID: ${p.runId}</p>
  </div>`;
}

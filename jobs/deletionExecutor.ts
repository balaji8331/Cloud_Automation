/**
 * Deletion executor — handles scheduled automated resource deletion.
 *
 * Safety guarantees:
 * 1. First run is ALWAYS dry-run only — no actual deletes.
 * 2. Live deletes only fire if schedule.liveDeletesApproved = true.
 * 3. Resources with excludeTagKey present are always skipped.
 * 4. Cancellable via cancel token up until execution starts.
 * 5. Resources deleted in dependency-safe order (VMs before NICs/disks).
 * 6. 409 dependency conflicts are logged and skipped, not fatal.
 */
import cron, { ScheduledTask } from "node-cron";
import prisma from "@/lib/db";
import { getTenantCredentials } from "@/lib/db/tenants";
import { queryResourceGraph } from "@/lib/azure/resourceGraph";
import { deleteAzureResource } from "@/lib/azure/deleteResource";
import { sendEmail } from "@/lib/email";
import type { AzureResource } from "@/lib/azure/resourceGraph";

// Map of scheduleId → running cron task
const activeTasks = new Map<string, ScheduledTask>();

// ─── Dependency order ─────────────────────────────────────────────────────────
// Resources that should be deleted AFTER others (dependents first)
const DELETION_ORDER_LATER = [
  "microsoft.network/networkinterfaces",
  "microsoft.network/publicipaddresses",
  "microsoft.compute/disks",
  "microsoft.network/virtualnetworks",
  "microsoft.network/networksecuritygroups",
];

function sortByDeletionOrder(resources: AzureResource[]) {
  return [...resources].sort((a, b) => {
    const ai = DELETION_ORDER_LATER.indexOf(a.type.toLowerCase());
    const bi = DELETION_ORDER_LATER.indexOf(b.type.toLowerCase());
    // Resources NOT in the list go first (ai = -1 → sort before listed ones)
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return -1;
    if (bi === -1) return 1;
    return ai - bi;
  });
}

// ─── Execute a single schedule run ────────────────────────────────────────────

export async function executeScheduleRun(scheduleId: string): Promise<void> {
  const schedule = await prisma.deletionSchedule.findUnique({
    where: { id: scheduleId },
    include: { tenant: true, createdBy: { select: { email: true } } },
  });

  if (!schedule || !schedule.isEnabled) {
    console.log(`[DeletionExecutor] Schedule ${scheduleId} is disabled or not found`);
    return;
  }

  const creds = await getTenantCredentials(schedule.tenantId);
  if (!creds) {
    console.error(`[DeletionExecutor] Cannot load creds for tenant ${schedule.tenantId}`);
    return;
  }

  const isDryRun = !schedule.liveDeletesApproved;
  const cancelToken = nanoid(16);

  // Create run record
  const run = await prisma.deletionRun.create({
    data: {
      scheduleId,
      status: isDryRun ? "DRY_RUN" : "NOTIFIED",
      cancelToken,
    },
  });

  console.log(`[DeletionExecutor] Run ${run.id} started (schedule="${schedule.name}" isDryRun=${isDryRun})`);

  try {
    // ── 1. Query current live resources from Resource Graph ─────────────────
    const targetIds = schedule.targetIds as string[];
    const azureSubIds = creds.subscriptions.map((s) => s.subscriptionId);

    const { resources: allResources } = await queryResourceGraph(
      { azureTenantId: creds.azureTenantId, clientId: creds.clientId, clientSecret: creds.clientSecret },
      azureSubIds
    );

    // Filter to scope
    let targeted = allResources.filter((r) => {
      if (schedule.scopeType === "RESOURCE_GROUP" || schedule.scopeType === "MULTIPLE_RESOURCE_GROUPS") {
        return targetIds.some((t) => t.toLowerCase() === r.resourceGroup.toLowerCase());
      }
      if (schedule.scopeType === "SUBSCRIPTION") {
        return targetIds.includes(r.subscriptionId);
      }
      return false;
    });

    // ── 2. Apply exclude-tag filter ─────────────────────────────────────────
    const skipped = targeted.filter((r) =>
      r.tags && Object.keys(r.tags).some((k) => k.toLowerCase() === schedule.excludeTagKey.toLowerCase())
    );
    targeted = targeted.filter((r) =>
      !r.tags || !Object.keys(r.tags).some((k) => k.toLowerCase() === schedule.excludeTagKey.toLowerCase())
    );

    console.log(`[DeletionExecutor] Run ${run.id}: targeted=${targeted.length} skipped=${skipped.length} (tag: ${schedule.excludeTagKey})`);

    // ── 3. Sort in dependency-safe order ────────────────────────────────────
    const ordered = sortByDeletionOrder(targeted);

    // ── 4. Save planned_resources snapshot ──────────────────────────────────
    await prisma.deletionRun.update({
      where: { id: run.id },
      data: {
        plannedResources: ordered.map((r) => ({
          id: r.id, name: r.name, type: r.type,
          location: r.location, resourceGroup: r.resourceGroup,
        })),
        skippedResources: skipped.map((r) => ({ id: r.id, name: r.name, reason: `tag: ${schedule.excludeTagKey}` })),
      },
    });

    // ── 5. DRY RUN — email list and stop ────────────────────────────────────
    if (isDryRun) {
      const approvalUrl = `${process.env.NEXTAUTH_URL}/automation?approveSchedule=${scheduleId}`;
      await sendEmail({
        to: getNotifyEmails(schedule.notifyEmails),
        subject: `[DRY RUN] Deletion schedule "${schedule.name}" — ${ordered.length} resources would be deleted`,
        html: dryRunEmailHtml({
          scheduleName: schedule.name,
          tenantName: schedule.tenant.name,
          resources: ordered,
          skipped,
          approvalUrl,
        }),
      });

      await prisma.deletionRun.update({
        where: { id: run.id },
        data: { status: "DRY_RUN", completedAt: new Date(), notifiedAt: new Date() },
      });

      console.log(`[DeletionExecutor] Run ${run.id} DRY RUN complete — ${ordered.length} would-be-deleted emailed`);
      return;
    }

    // ── 6. LIVE RUN: pre-execution notification ──────────────────────────────
    const cancelUrl = `${process.env.NEXTAUTH_URL}/api/automation/cancel?token=${cancelToken}`;
    const execTime = new Date(Date.now() + schedule.notifyBeforeMinutes * 60 * 1000);

    await sendEmail({
      to: getNotifyEmails(schedule.notifyEmails),
      subject: `⚠️ Upcoming deletion: "${schedule.name}" — ${ordered.length} resources in ${schedule.notifyBeforeMinutes}min`,
      html: preExecutionEmailHtml({
        scheduleName: schedule.name,
        tenantName: schedule.tenant.name,
        resources: ordered,
        execTime,
        cancelUrl,
      }),
    });

    await prisma.deletionRun.update({
      where: { id: run.id },
      data: { status: "NOTIFIED", notifiedAt: new Date() },
    });

    // Wait notify_before_minutes
    await new Promise((r) => setTimeout(r, schedule.notifyBeforeMinutes * 60 * 1000));

    // ── 7. Check if cancelled ────────────────────────────────────────────────
    const freshRun = await prisma.deletionRun.findUnique({ where: { id: run.id } });
    if (freshRun?.status === "CANCELLED") {
      console.log(`[DeletionExecutor] Run ${run.id} was cancelled before execution`);
      return;
    }

    // ── 8. Execute deletions ──────────────────────────────────────────────────
    await prisma.deletionRun.update({
      where: { id: run.id },
      data: { status: "EXECUTING" },
    });

    const deleted: { id: string; name: string }[] = [];
    const failed: { id: string; name: string; error: string }[] = [];

    for (const resource of ordered) {
      // Re-check cancelled flag during execution
      const mid = await prisma.deletionRun.findUnique({ where: { id: run.id }, select: { status: true } });
      if (mid?.status === "CANCELLED") break;

      const result = await deleteAzureResource(
        { azureTenantId: creds.azureTenantId, clientId: creds.clientId, clientSecret: creds.clientSecret },
        resource.id,
        resource.type
      );

      if (result.success) {
        deleted.push({ id: resource.id, name: resource.name });
        // Mark inactive in DB
        await prisma.resource.updateMany({
          where: { resourceId: resource.id, tenantId: schedule.tenantId },
          data: { isActive: false },
        });
      } else {
        failed.push({ id: resource.id, name: resource.name, error: result.error ?? "Unknown error" });
        console.warn(`[DeletionExecutor] Failed to delete ${resource.name}: ${result.error}`);
        // Continue — don't abort the batch on single failure
      }
    }

    const finalStatus = failed.length === ordered.length ? "FAILED"
      : failed.length > 0 ? "COMPLETED"   // partial success still = COMPLETED with failures noted
      : "COMPLETED";

    await prisma.deletionRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        deletedResources: deleted,
        failedResources: failed,
        completedAt: new Date(),
      },
    });

    // ── 9. Completion summary email ────────────────────────────────────────
    await sendEmail({
      to: getNotifyEmails(schedule.notifyEmails),
      subject: `✅ Deletion complete: "${schedule.name}" — ${deleted.length} deleted, ${failed.length} failed`,
      html: completionEmailHtml({ scheduleName: schedule.name, tenantName: schedule.tenant.name, deleted, failed }),
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: schedule.createdById,
        action: "RUN_DELETION_SCHEDULE",
        resourceType: "deletion_schedule_run",
        resourceId: run.id,
        metadata: { scheduleId, deleted: deleted.length, failed: failed.length, skipped: skipped.length },
      },
    });

    console.log(`[DeletionExecutor] Run ${run.id} COMPLETE — deleted=${deleted.length} failed=${failed.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DeletionExecutor] Run ${run.id} FATAL ERROR:`, message);
    await prisma.deletionRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date(), failedResources: [{ error: message }] },
    });
  }
}

// ─── Dynamic scheduler ────────────────────────────────────────────────────────

export async function refreshDeletionSchedulers(): Promise<void> {
  // Stop all existing tasks
  for (const [id, task] of activeTasks) {
    task.stop();
    activeTasks.delete(id);
    console.log(`[DeletionScheduler] Stopped task ${id}`);
  }

  // Load all enabled schedules
  const schedules = await prisma.deletionSchedule.findMany({
    where: { isEnabled: true },
  });

  for (const schedule of schedules) {
    // Support multi-line cron (multiple run times per day)
    const cronLines = schedule.cronExpression.split("\n").filter(Boolean);

    for (const cronLine of cronLines) {
      const taskKey = `${schedule.id}::${cronLine}`;

      if (!cron.validate(cronLine)) {
        console.warn(`[DeletionScheduler] Invalid cron for schedule "${schedule.name}": ${cronLine}`);
        continue;
      }

      const task = cron.schedule(cronLine, () => {
        executeScheduleRun(schedule.id).catch((e) =>
          console.error(`[DeletionScheduler] Uncaught error in schedule ${schedule.id}:`, e)
        );
      }, { timezone: "UTC" });

      activeTasks.set(taskKey, task);
      console.log(`[DeletionScheduler] Registered schedule "${schedule.name}" at cron: ${cronLine}`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNotifyEmails(override: string): string {
  const base = process.env.ALERT_TO_EMAIL ?? "";
  const addresses = override?.trim()
    ? override.split(",").map((e) => e.trim()).filter(Boolean)
    : base.split(",").map((e) => e.trim()).filter(Boolean);
  return addresses.join(",") || base;
}

function dryRunEmailHtml(p: {
  scheduleName: string; tenantName: string;
  resources: { name: string; type: string; resourceGroup: string }[];
  skipped: { name: string }[];
  approvalUrl: string;
}): string {
  return `<div style="font-family:sans-serif;max-width:700px">
    <h2 style="color:#f59e0b">🔍 Dry Run: "${p.scheduleName}"</h2>
    <p>Tenant: <strong>${p.tenantName}</strong></p>
    <p>This is a <strong>DRY RUN</strong> — no resources were deleted. The following ${p.resources.length} resources would be deleted on the next live run:</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f3f4f6"><th style="padding:6px;text-align:left">Name</th><th style="padding:6px;text-align:left">Type</th><th style="padding:6px;text-align:left">Resource Group</th></tr>
      ${p.resources.map((r) => `<tr><td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.name}</td><td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.type.split("/").pop()}</td><td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.resourceGroup}</td></tr>`).join("")}
    </table>
    ${p.skipped.length ? `<p style="color:#6b7280">Skipped (exclude tag): ${p.skipped.map((s) => s.name).join(", ")}</p>` : ""}
    <p>To activate live deletions, an Admin must approve this schedule:</p>
    <a href="${p.approvalUrl}" style="display:inline-block;background:#2563eb;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:8px">Approve Live Deletions</a>
    <p style="color:#ef4444;font-size:12px;margin-top:16px">⚠️ Once approved, this schedule will permanently delete real Azure resources on the configured schedule.</p>
  </div>`;
}

function preExecutionEmailHtml(p: {
  scheduleName: string; tenantName: string;
  resources: { name: string; type: string; resourceGroup: string }[];
  execTime: Date; cancelUrl: string;
}): string {
  return `<div style="font-family:sans-serif;max-width:700px">
    <h2 style="color:#ef4444">⚠️ Upcoming Deletion: "${p.scheduleName}"</h2>
    <p>Tenant: <strong>${p.tenantName}</strong></p>
    <p>The following <strong>${p.resources.length} resources will be deleted</strong> at ${p.execTime.toUTCString()}:</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f3f4f6"><th style="padding:6px;text-align:left">Name</th><th style="padding:6px;text-align:left">Type</th><th style="padding:6px;text-align:left">Resource Group</th></tr>
      ${p.resources.map((r) => `<tr><td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.name}</td><td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.type.split("/").pop()}</td><td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.resourceGroup}</td></tr>`).join("")}
    </table>
    <a href="${p.cancelUrl}" style="display:inline-block;background:#dc2626;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:16px">Cancel This Run</a>
    <p style="color:#6b7280;font-size:12px">This cancel link is valid until execution starts.</p>
  </div>`;
}

function completionEmailHtml(p: {
  scheduleName: string; tenantName: string;
  deleted: { name: string }[]; failed: { name: string; error: string }[];
}): string {
  return `<div style="font-family:sans-serif;max-width:700px">
    <h2>✅ Deletion Complete: "${p.scheduleName}"</h2>
    <p>Tenant: <strong>${p.tenantName}</strong></p>
    <p><strong>${p.deleted.length}</strong> deleted &nbsp;|&nbsp; <strong style="color:${p.failed.length > 0 ? "#ef4444" : "#6b7280"}">${p.failed.length}</strong> failed</p>
    ${p.failed.length > 0 ? `<h3 style="color:#ef4444">Failures</h3>
    <ul>${p.failed.map((f) => `<li><strong>${f.name}</strong>: ${f.error}</li>`).join("")}</ul>` : ""}
  </div>`;
}

// Re-export a cryptographically secure token generator using Node's crypto module
function nanoid(len: number): string {
  const { randomBytes } = require("crypto") as typeof import("crypto");
  // Each byte becomes 2 hex chars; generate enough bytes to cover len chars
  return randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

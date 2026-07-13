/**
 * Deletion executor — handles dry runs and live deletion runs.
 *
 * Safety guarantees:
 * 1. executeDryRun: queries resources, emails list, marks DRY_RUN — never deletes.
 * 2. executeLiveRun: only fires if approvalStatus = APPROVED.
 * 3. Resources with excludeTagKey present are always skipped.
 * 4. Cancellable via cancel token up until execution starts.
 * 5. Resources deleted in dependency-safe order (type depth + explicit priority table).
 * 6. Nested-resource retry: if parent fails with "nested resources exist", children
 *    are inserted ahead of it in the queue and parent is retried (max 3 times).
 * 7. API versions resolved dynamically from Azure Resource Providers API (1h cache).
 */
import prisma from "@/lib/db";
import { ApprovalStatus } from "@prisma/client";
import { getTenantCredentials } from "@/lib/db/tenants";
import { getProviderClient } from "@/lib/providers";
import type { NormalizedResource } from "@/lib/providers/types";
import { sendEmail } from "@/lib/email";
import { randomBytes } from "crypto";

// Local augmentation for filtering
export type AzureResource = NormalizedResource & { subscriptionId: string };

// ─── Dependency-aware deletion ordering ───────────────────────────────────────

const PARENT_TYPE_PRIORITY: Record<string, number> = {
  "microsoft.compute/virtualmachines": 0,
  "microsoft.compute/virtualmachines/extensions": 100,
/**
 * PERFORMANCE OPTIMIZATION ONLY
 * This graph is a performance optimization for known-common dependency patterns — 
 * it reduces wasted delete attempts for cases we've already seen fail. 
 * It is NOT the correctness guarantee for arbitrary resource types. 
 * The generic retry loop (isNestedResourceError + findChildResources + deferredParents) 
 * is what makes deletion correct for resource types NOT in this graph — 
 * do not remove or weaken the retry loop under the assumption the graph covers everything.
 */
const TYPE_DEPENDENCY_GRAPH: [string, string][] = [
  ["microsoft.compute/virtualmachines", "microsoft.compute/disks"],
  ["microsoft.compute/virtualmachines", "microsoft.network/networkinterfaces"],
  ["microsoft.network/networkinterfaces", "microsoft.network/publicipaddresses"],
  ["microsoft.network/networkinterfaces", "microsoft.network/virtualnetworks"],
  ["microsoft.network/networkinterfaces", "microsoft.network/networksecuritygroups"],
  ["microsoft.network/virtualnetworks", "microsoft.network/networksecuritygroups"],
  ["microsoft.web/sites", "microsoft.web/serverfarms"],
  ["microsoft.compute/virtualmachines/extensions", "microsoft.compute/virtualmachines"],
];

function buildTypeRanks(): Record<string, number> {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const [first, after] of TYPE_DEPENDENCY_GRAPH) {
    if (!graph.has(first)) graph.set(first, []);
    if (!graph.has(after)) graph.set(after, []);
    if (!inDegree.has(first)) inDegree.set(first, 0);
    if (!inDegree.has(after)) inDegree.set(after, 0);
  }

  for (const [first, after] of TYPE_DEPENDENCY_GRAPH) {
    graph.get(first)!.push(after);
    inDegree.set(after, inDegree.get(after)! + 1);
  }

  const ranks: Record<string, number> = {};
  const queue: string[] = [];
  let currentRank = 0;

  for (const [node, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(node);
  }

  while (queue.length > 0) {
    const size = queue.length;
    for (let i = 0; i < size; i++) {
      const node = queue.shift()!;
      ranks[node] = currentRank;
      for (const neighbor of graph.get(node)!) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) queue.push(neighbor);
      }
    }
    currentRank++;
  }
  return ranks;
}

const typeRanks = buildTypeRanks();

const PARENT_TYPE_PRIORITY: Record<string, number> = {
  "microsoft.cognitiveservices/accounts": 0,
  "microsoft.cognitiveservices/accounts/projects": 100,
  "microsoft.cognitiveservices/accounts/deployments": 100,
  "microsoft.cognitiveservices/accounts/models": 100,
  "microsoft.storage/storageaccounts": 0,
  "microsoft.storage/storageaccounts/blobservices": 100,
  "microsoft.storage/storageaccounts/fileservices": 100,
  "microsoft.storage/storageaccounts/queueservices": 100,
  "microsoft.storage/storageaccounts/tableservices": 100,
  "microsoft.sql/servers": 0,
  "microsoft.sql/servers/databases": 100,
  "microsoft.sql/servers/firewallrules": 100,
  "microsoft.web/sites/slots": 100,
  "microsoft.containerregistry/registries": 0,
  "microsoft.containerregistry/registries/webhooks": 100,
  "microsoft.keyvault/vaults": 0,
  "microsoft.keyvault/vaults/keys": 100,
  "microsoft.keyvault/vaults/secrets": 100,
};

export function sortResourcesForDeletion(resources: AzureResource[]): AzureResource[] {
  return [...resources].sort((a, b) => {
    const typeA = a.type.toLowerCase();
    const typeB = b.type.toLowerCase();

    const getRank = (t: string) => {
      if (typeRanks[t] !== undefined) return typeRanks[t];
      const parts = t.split("/");
      if (parts.length > 2) {
        const base = parts.slice(0, 2).join("/");
        return typeRanks[base];
      }
      return undefined;
    };

    const rankA = getRank(typeA);
    const rankB = getRank(typeB);

    if (rankA !== undefined && rankB !== undefined) {
      if (rankA !== rankB) return rankA - rankB;
    } else if (rankA !== undefined && rankB === undefined) {
      return -1;
    } else if (rankA === undefined && rankB !== undefined) {
      return 1;
    }

    const typeDepthA = typeA.split("/").length;
    const typeDepthB = typeB.split("/").length;
    if (typeDepthA !== typeDepthB) return typeDepthB - typeDepthA;
    const idDepthA = a.id.split("/").length;
    const idDepthB = b.id.split("/").length;
    if (idDepthA !== idDepthB) return idDepthB - idDepthA;
    const prioA = PARENT_TYPE_PRIORITY[typeA] ?? 50;
    const prioB = PARENT_TYPE_PRIORITY[typeB] ?? 50;
    if (prioA !== prioB) return prioB - prioA;
    return typeA.localeCompare(typeB);
  });
}

function isNestedResourceError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("nested resource") ||
    lower.includes("child resource") ||
    (lower.includes("cannot delete") && lower.includes("exist")) ||
    lower.includes("must be disassociated") ||
    lower.includes("must be detached") ||
    lower.includes("is in use by") ||
    lower.includes("referenced by")
  );
}

function findChildResources(
  parent: AzureResource,
  allResources: AzureResource[],
  errorMessage?: string
): AzureResource[] {
  const childPrefix = parent.id.toLowerCase() + "/";
  const byPrefix = allResources.filter(
    (r) => r.id !== parent.id && r.id.toLowerCase().startsWith(childPrefix)
  );
  if (byPrefix.length > 0) return byPrefix;

  if (errorMessage) {
    const quoted = errorMessage.match(/'([^']+)'/g) ?? [];
    const names = new Set<string>();
    for (const q of quoted) {
      const lastSegment = q.slice(1, -1).split("/").pop();
      if (lastSegment) names.add(lastSegment.toLowerCase());
    }
    return allResources.filter((r) => {
      if (r.id === parent.id || !names.has(r.name.toLowerCase())) return false;
      
      const pType = parent.type.toLowerCase();
      const cType = r.type.toLowerCase();
      
      const isInGraph = TYPE_DEPENDENCY_GRAPH.some(([t1, t2]) => 
        (t1.toLowerCase() === pType && t2.toLowerCase() === cType) ||
        (t1.toLowerCase() === cType && t2.toLowerCase() === pType)
      );
      
      if (isInGraph) {
        return true; // Confirmed by graph
      }
      
      // Generic fallback for types not hardcoded in the static graph
      return true;
    });
  }
  return [];
}

// ─── Shared resource query helper ─────────────────────────────────────────────

async function queryTargetedResources(
  schedule: {
    tenantId: string;
    scopeType: string;
    targetIds: unknown;
    excludeTagKey: string;
  }
): Promise<{
  creds: NonNullable<Awaited<ReturnType<typeof getTenantCredentials>>>;
  ordered: AzureResource[];
  skipped: AzureResource[];
  allResources: AzureResource[];
} | null> {
  const creds = await getTenantCredentials(schedule.tenantId);
  if (!creds) return null;

  const targetIds = schedule.targetIds as string[];
  const azureSubIds = creds.subscriptions.map((s) => s.subscriptionId);

  const providerClient = getProviderClient({
    provider: creds.provider,
    credentialData: creds.credentialData
  });

  const allResources: AzureResource[] = [];
  for (const subId of azureSubIds) {
    const res = await providerClient.listResources({ providerScopeId: subId });
    allResources.push(...res.map((r) => ({ ...r, subscriptionId: subId })));
  }

  let targeted = allResources.filter((r) => {
    if (schedule.scopeType === "RESOURCE_GROUP" || schedule.scopeType === "MULTIPLE_RESOURCE_GROUPS") {
      return (targetIds).some((t) => t.toLowerCase() === r.resourceGroup.toLowerCase());
    }
    if (schedule.scopeType === "SUBSCRIPTION") {
      return targetIds.includes(r.subscriptionId);
    }
    return false;
  });

  const skipped = targeted.filter((r) =>
    r.tags && Object.keys(r.tags).some((k) => k.toLowerCase() === schedule.excludeTagKey.toLowerCase())
  );
  targeted = targeted.filter((r) =>
    !r.tags || !Object.keys(r.tags).some((k) => k.toLowerCase() === schedule.excludeTagKey.toLowerCase())
  );

  const ordered = sortResourcesForDeletion(targeted);
  return { creds, ordered, skipped, allResources };
}

// ─── DRY RUN ──────────────────────────────────────────────────────────────────

/**
 * Execute a dry run for a schedule:
 * - Queries live resources from Resource Graph
 * - Saves planned_resources snapshot
 * - Sends dry-run email with Approve link
 * - Sets run status = DRY_RUN
 * - Does NOT modify any Azure resources
 */
export async function executeDryRun(scheduleId: string): Promise<string> {
  const schedule = await prisma.deletionSchedule.findUnique({
    where: { id: scheduleId },
    include: { tenant: true, createdBy: { select: { email: true } } },
  });

  if (!schedule || !schedule.isEnabled) {
    throw new Error(`Schedule ${scheduleId} not found or disabled`);
  }

  const result = await queryTargetedResources(schedule);
  if (!result) throw new Error(`Cannot load credentials for tenant ${schedule.tenantId}`);
  const { ordered, skipped } = result;

  // Generate a secure approve token (expires in 7 days)
  const approveToken = randomBytes(24).toString("hex");
  const approveTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.deletionSchedule.update({
    where: { id: scheduleId },
    data: { approveToken, approveTokenExpiresAt },
  });

  // Create run record
  const run = await prisma.deletionRun.create({
    data: {
      scheduleId,
      status: "DRY_RUN",
      plannedResources: ordered.map((r) => ({
        id: r.id, name: r.name, type: r.type,
        location: r.location, resourceGroup: r.resourceGroup,
      })),
      skippedResources: skipped.map((r) => ({
        id: r.id, name: r.name, reason: `tag: ${schedule.excludeTagKey}`,
      })),
      completedAt: new Date(),
      notifiedAt: new Date(),
    },
  });

  // Send dry-run email with one-click Approve link
  const approveUrl = `${process.env.NEXTAUTH_URL}/api/automation/schedules/${scheduleId}/approve?token=${approveToken}`;
  await sendEmail({
    to: getNotifyEmails(schedule.notifyEmails),
    subject: `[DRY RUN] "${schedule.name}" — ${ordered.length} resources would be deleted`,
    html: dryRunEmailHtml({
      scheduleName: schedule.name,
      tenantName: schedule.tenant.name,
      resources: ordered,
      skipped,
      approveUrl,
      cronDescription: schedule.cronExpression,
    }),
  });

  console.log(`[DeletionExecutor] Dry run ${run.id} complete for "${schedule.name}" — ${ordered.length} resources, email sent`);
  return run.id;
}

// ─── LIVE RUN ─────────────────────────────────────────────────────────────────

/**
 * Execute a live deletion run.
 * Called by the AutomationPoller when scheduledExecutionAt <= now.
 * The run record (status=NOTIFIED) must already exist — this function
 * transitions it through EXECUTING → COMPLETED/FAILED.
 */
export async function executeLiveRun(scheduleId: string, runId: string): Promise<void> {
  const schedule = await prisma.deletionSchedule.findUnique({
    where: { id: scheduleId },
    include: { tenant: true, createdBy: { select: { email: true } } },
  });

  if (!schedule) {
    console.error(`[DeletionExecutor] Schedule ${scheduleId} not found`);
    return;
  }
  if (schedule.approvalStatus !== ApprovalStatus.APPROVED) {
    console.warn(`[DeletionExecutor] Schedule "${schedule.name}" is not approved (status=${schedule.approvalStatus}) — aborting live run`);
    await prisma.deletionRun.update({
      where: { id: runId },
      data: { status: "CANCELLED", completedAt: new Date(), cancelledBy: "system:not_approved" },
    });
    return;
  }

  // Verify run is still NOTIFIED (not cancelled during the wait window)
  const run = await prisma.deletionRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "CANCELLED") {
    console.log(`[DeletionExecutor] Run ${runId} was cancelled — skipping`);
    return;
  }

  const result = await queryTargetedResources(schedule);
  if (!result) {
    await prisma.deletionRun.update({
      where: { id: runId },
      data: { status: "FAILED", completedAt: new Date(), failedResources: [{ error: "Cannot load tenant credentials" }] },
    });
    return;
  }
  const { creds, ordered, skipped, allResources } = result;

  console.log(`[DeletionExecutor] Live run ${runId} — ${ordered.length} targeted, ${skipped.length} skipped`);

  // Update planned snapshot (resources may have changed since notification)
  await prisma.deletionRun.update({
    where: { id: runId },
    data: {
      status: "EXECUTING",
      plannedResources: ordered.map((r) => ({
        id: r.id, name: r.name, type: r.type,
        location: r.location, resourceGroup: r.resourceGroup,
      })),
      skippedResources: skipped.map((r) => ({
        id: r.id, name: r.name, reason: `tag: ${schedule.excludeTagKey}`,
      })),
    },
  });

  const deleted: { id: string; name: string }[] = [];
  const failed: { id: string; name: string; error: string }[] = [];
  const pendingDeletions = [...ordered];
  const deferredParents: Array<{ resource: AzureResource; retries: number }> = [];
  const MAX_RETRIES = 3;

  try {
    while (pendingDeletions.length > 0) {
      const resource = pendingDeletions.shift()!;

      // Re-check cancellation mid-execution
      const mid = await prisma.deletionRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (mid?.status === "CANCELLED") {
        console.log(`[DeletionExecutor] Run ${runId} cancelled mid-execution`);
        break;
      }

      const providerClient = getProviderClient({ provider: creds.provider, credentialData: creds.credentialData });

      try {
        await providerClient.deleteResource(resource.id);
        
        deleted.push({ id: resource.id, name: resource.name });
        await prisma.resource.updateMany({
          where: { resourceId: resource.id, tenantId: schedule.tenantId },
          data: { isActive: false },
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        
        if (isNestedResourceError(errorMsg)) {
          const existingDefer = deferredParents.find((d) => d.resource.id === resource.id);
          if (existingDefer) {
            existingDefer.retries++;
            if (existingDefer.retries >= MAX_RETRIES) {
              failed.push({ id: resource.id, name: resource.name, error: `Max retries exceeded: ${errorMsg}` });
            } else {
              pendingDeletions.push(resource);
            }
          } else {
            deferredParents.push({ resource, retries: 0 });
            const pendingIds = new Set(pendingDeletions.map((r) => r.id));
            const deletedIds = new Set(deleted.map((d) => d.id));
            const children = findChildResources(resource, allResources, errorMsg)
              .filter((c) => !deletedIds.has(c.id) && !pendingIds.has(c.id));
            if (children.length > 0) {
              pendingDeletions.unshift(...sortResourcesForDeletion(children));
            }
            pendingDeletions.push(resource);
            console.log(`[DeletionExecutor] Deferred "${resource.name}" — ${children.length} child(ren) inserted ahead`);
            console.log(`[DeletionExecutor] Resource ${resource.name} reordered via retry-loop fallback after live failure (static graph missed this dependency)`);
          }
        } else {
          failed.push({ id: resource.id, name: resource.name, error: errorMsg ?? "Unknown error" });
          console.warn(`[DeletionExecutor] Failed to delete ${resource.name}: ${errorMsg}`);
        }
      }
    }

    const finalStatus = failed.length === ordered.length && ordered.length > 0 ? "FAILED" : "COMPLETED";

    await prisma.deletionRun.update({
      where: { id: runId },
      data: { status: finalStatus, deletedResources: deleted, failedResources: failed, completedAt: new Date() },
    });

    await sendEmail({
      to: getNotifyEmails(schedule.notifyEmails),
      subject: `✅ Deletion complete: "${schedule.name}" — ${deleted.length} deleted, ${failed.length} failed`,
      html: completionEmailHtml({ scheduleName: schedule.name, tenantName: schedule.tenant.name, deleted, failed }),
    });

    await prisma.auditLog.create({
      data: {
        userId: schedule.createdById,
        action: "RUN_DELETION_SCHEDULE",
        resourceType: "deletion_schedule_run",
        resourceId: runId,
        metadata: { scheduleId, deleted: deleted.length, failed: failed.length, skipped: skipped.length },
      },
    });

    console.log(`[DeletionExecutor] Live run ${runId} COMPLETE — deleted=${deleted.length} failed=${failed.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DeletionExecutor] Run ${runId} FATAL ERROR:`, message);
    await prisma.deletionRun.update({
      where: { id: runId },
      data: { status: "FAILED", completedAt: new Date(), failedResources: [{ error: message }] },
    }).catch(() => {});
  }
}

/**
 * Manual trigger — respects approvalStatus.
 * If PENDING_DRY_RUN or AWAITING_APPROVAL → runs dry run.
 * If APPROVED → creates a NOTIFIED run and fires immediately (no wait window).
 * Used by "Run Now" button only — not called by the poller.
 */
export async function executeScheduleRun(scheduleId: string): Promise<void> {
  const schedule = await prisma.deletionSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule || !schedule.isEnabled) return;

  if (schedule.approvalStatus !== ApprovalStatus.APPROVED) {
    // Treat as dry run
    await executeDryRun(scheduleId);
    if (schedule.approvalStatus === ApprovalStatus.PENDING_DRY_RUN) {
      await prisma.deletionSchedule.update({
        where: { id: scheduleId },
        data: { approvalStatus: ApprovalStatus.AWAITING_APPROVAL },
      });
    }
    return;
  }

  // APPROVED: create a run and execute immediately (manual override skips notify window)
  const cancelToken = randomBytes(16).toString("hex");
  const run = await prisma.deletionRun.create({
    data: {
      scheduleId,
      status: "NOTIFIED",
      cancelToken,
      notifiedAt: new Date(),
      scheduledExecutionAt: new Date(), // execute immediately
    },
  });

  await executeLiveRun(scheduleId, run.id);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function dryRunEmailHtml(p: {
  scheduleName: string; tenantName: string;
  resources: { name: string; type: string; resourceGroup: string }[];
  skipped: { name: string }[];
  approveUrl: string;
  cronDescription: string;
}): string {
  return `<div style="font-family:sans-serif;max-width:700px">
    <h2 style="color:#f59e0b">🔍 Dry Run Complete: "${p.scheduleName}"</h2>
    <p>Tenant: <strong>${p.tenantName}</strong></p>
    <p>This is a <strong>DRY RUN</strong> — no resources were deleted. The following
       <strong>${p.resources.length}</strong> resources <em>would</em> be deleted on each live run:</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f3f4f6">
        <th style="padding:6px;text-align:left">Name</th>
        <th style="padding:6px;text-align:left">Type</th>
        <th style="padding:6px;text-align:left">Resource Group</th>
      </tr>
      ${p.resources.map((r) => `<tr>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.name}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.type.split("/").pop()}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.resourceGroup}</td>
      </tr>`).join("")}
    </table>
    ${p.skipped.length ? `<p style="color:#6b7280;margin-top:8px">Skipped (exclude tag): ${p.skipped.map((s) => s.name).join(", ")}</p>` : ""}
    <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb"/>
    <p><strong>One click to approve live deletions:</strong></p>
    <p>Once approved, this schedule will run automatically per its configured time.
       You will receive a notification email before each run with a Cancel option.</p>
    <a href="${p.approveUrl}" style="display:inline-block;background:#16a34a;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
      ✓ Approve Live Deletions
    </a>
    <p style="color:#ef4444;font-size:12px;margin-top:16px">
      ⚠️ Once approved, this schedule will permanently delete real Azure resources on the configured schedule.
      This link expires in 7 days.
    </p>
  </div>`;
}

function completionEmailHtml(p: {
  scheduleName: string; tenantName: string;
  deleted: { name: string }[]; failed: { name: string; error: string }[];
}): string {
  return `<div style="font-family:sans-serif;max-width:700px">
    <h2>✅ Deletion Complete: "${p.scheduleName}"</h2>
    <p>Tenant: <strong>${p.tenantName}</strong></p>
    <p><strong>${p.deleted.length}</strong> deleted &nbsp;|&nbsp;
       <strong style="color:${p.failed.length > 0 ? "#ef4444" : "#6b7280"}">${p.failed.length}</strong> failed</p>
    ${p.failed.length > 0 ? `<h3 style="color:#ef4444">Failures</h3>
    <ul>${p.failed.map((f) => `<li><strong>${f.name}</strong>: ${f.error}</li>`).join("")}</ul>` : ""}
  </div>`;
}

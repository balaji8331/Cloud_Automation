/**
 * Cost ingestion job — pulls last 30 days of cost data for all active tenants.
 * Called by:
 *   - Daily cron (jobs/scheduler.ts)
 *   - POST /api/jobs/ingest (manual "Sync Now")
 */
import prisma from "@/lib/db";
import { getTenantCredentials } from "@/lib/db/tenants";
import { setTenantStatus } from "@/lib/db/tenants";
import { upsertCostRecords } from "@/lib/db/costs";
import { getProviderClient } from "@/lib/providers";
import { runTenantOperation } from "@/lib/azure/tenantQueue";
import { detectAnomalies } from "./anomaly";
import { toUsd } from "@/lib/currency";

export interface IngestResult {
  tenantId: string;
  tenantName: string;
  success: boolean;
  recordsIngested: number;
  error?: string;
}

/**
 * Ingest cost data for a single tenant.
 * @param tenantId  Internal DB UUID
 * @param daysBack  How many days of history to pull (default 30)
 */
export async function ingestTenant(
  tenantId: string,
  daysBack = 7,
  options?: { rejectIfBusy?: boolean }
): Promise<IngestResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });

  if (!tenant) {
    return { tenantId, tenantName: "Unknown", success: false, recordsIngested: 0, error: "Tenant not found" };
  }

  const creds = await getTenantCredentials(tenantId);
  if (!creds) {
    return { tenantId, tenantName: tenant.name, success: false, recordsIngested: 0, error: "Could not load credentials" };
  }

  return runTenantOperation(
    creds.azureTenantId,
    "ingest",
    () => ingestTenantWork(tenantId, tenant.name, creds, daysBack),
    options
  );
}

async function ingestTenantWork(
  tenantId: string,
  tenantName: string,
  creds: NonNullable<Awaited<ReturnType<typeof getTenantCredentials>>>,
  daysBack: number
): Promise<IngestResult> {

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysBack);

  let totalRecords = 0;

  const providerClient = getProviderClient({
    provider: creds.provider,
    credentialData: creds.credentialData
  });

  try {
    for (const sub of creds.subscriptions) {
      console.log(`[Ingest] Querying ${sub.subscriptionId} (${sub.subscriptionName ?? "unnamed"})`);

      const rows = await providerClient.queryCosts(
        { providerScopeId: sub.subscriptionId },
        { from, to }
      );

      const records = rows.map((row) => ({
        tenantId,
        subscriptionId: sub.id,
        date: new Date(row.date),
        resourceGroup: row.resourceGroup || undefined,
        serviceName: row.serviceName || undefined,
        cost: row.cost,
        currency: row.currency,
        // Normalize to USD using configured exchange rates
        normalizedCostUsd: toUsd(row.cost, row.currency),
      }));

      const count = await upsertCostRecords(records);
      totalRecords += count;

      // Update subscription name if we got it from Cost Management
      if (sub.subscriptionName === null && rows.length > 0) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { subscriptionName: sub.subscriptionId },
        });
      }

      // Small delay between subscriptions to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1500));
    }

    await setTenantStatus(tenantId, "CONNECTED");

    // Run anomaly detection after fresh data lands
    await detectAnomalies(tenantId).catch((e) =>
      console.error("[Anomaly] Detection failed:", e)
    );

    return { tenantId, tenantName, success: true, recordsIngested: totalRecords };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Ingest] Tenant ${tenantName} failed:`, message);
    await setTenantStatus(tenantId, "ERROR", message);
    return { tenantId, tenantName, success: false, recordsIngested: totalRecords, error: message };
  }
}

/**
 * Ingest all active tenants.
 */
export async function ingestAllTenants(daysBack = 30): Promise<IngestResult[]> {
  const tenants = await prisma.tenant.findMany({
    where: { status: { not: "ERROR" } },
    select: { id: true },
  });

  console.log(`[Ingest] Starting ingestion for ${tenants.length} tenants`);

  const results: IngestResult[] = [];
  for (const t of tenants) {
    const result = await ingestTenant(t.id, daysBack);
    results.push(result);
    console.log(
      `[Ingest] ${result.tenantName}: ${result.success ? `✅ ${result.recordsIngested} records` : `❌ ${result.error}`}`
    );
  }

  return results;
}

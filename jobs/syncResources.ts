/**
 * Resource inventory sync job.
 *
 * BUG FIXES applied:
 * 1. Resources skipped silently when RG name from Resource Graph doesn't match DB
 *    → now creates a placeholder RG on the fly and logs the skip reason
 * 2. Empty resourceGroup string from Azure (management resources) was causing
 *    findFirst to return null and silently drop the resource → now handled
 * 3. Added per-step logging so count drops are visible
 * 4. Stale-marking uses lastSyncedAt timestamp instead of notIn([...]) array
 *    to avoid Postgres parameter limits on large inventories
 */
import prisma from "@/lib/db";
import { getTenantCredentials } from "@/lib/db/tenants";
import { queryResourceGraph, queryResourceGroups } from "@/lib/azure/resourceGraph";

export interface ResourceSyncResult {
  tenantId: string;
  tenantName: string;
  success: boolean;
  resourceGroupsUpserted: number;
  resourcesUpserted: number;
  resourcesSkipped: number;
  staleMarked: number;
  error?: string;
}

export async function syncTenantResources(tenantId: string): Promise<ResourceSyncResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });

  if (!tenant) {
    return { tenantId, tenantName: "Unknown", success: false, resourceGroupsUpserted: 0, resourcesUpserted: 0, resourcesSkipped: 0, staleMarked: 0, error: "Tenant not found" };
  }

  const creds = await getTenantCredentials(tenantId);
  if (!creds) {
    return { tenantId, tenantName: tenant.name, success: false, resourceGroupsUpserted: 0, resourcesUpserted: 0, resourcesSkipped: 0, staleMarked: 0, error: "Could not load credentials" };
  }

  // BUG CHECK 3: subIdMap key = Azure raw GUID, value = internal DB UUID — correct
  const azureSubIds = creds.subscriptions.map((s) => s.subscriptionId);
  const subIdMap = new Map(creds.subscriptions.map((s) => [s.subscriptionId.toLowerCase(), s.id]));

  const syncedAt = new Date();

  try {
    // ── 1. Sync resource groups ────────────────────────────────────────────
    const azureRGs = await queryResourceGroups(
      { azureTenantId: creds.azureTenantId, clientId: creds.clientId, clientSecret: creds.clientSecret },
      azureSubIds
    );
    // Build a local map: "internalSubId:rgNameLower" → DB record id
    const rgMap = new Map<string, string>();

    for (const rg of azureRGs) {
      // BUG CHECK 3: normalize to lowercase for lookup
      const internalSubId = subIdMap.get(rg.subscriptionId.toLowerCase());
      if (!internalSubId) {
        console.warn(`[ResourceSync] RG "${rg.name}" — Azure subscriptionId ${rg.subscriptionId} not in subIdMap, skipping`);
        continue;
      }

      const record = await prisma.resourceGroup.upsert({
        where: { tenantId_subscriptionId_name: { tenantId, subscriptionId: internalSubId, name: rg.name } },
        create: {
          tenantId,
          subscriptionId: internalSubId,
          name: rg.name,
          location: rg.location,
          tags: (rg.tags ?? {}) as Record<string, string>,
          isActive: true,
          lastSyncedAt: syncedAt,
        },
        update: {
          location: rg.location,
          tags: (rg.tags ?? {}) as Record<string, string>,
          isActive: true,
          lastSyncedAt: syncedAt,
        },
      });

      // BUG FIX 1: build map with both exact and lowercase key for lookup
      rgMap.set(`${internalSubId}:${rg.name.toLowerCase()}`, record.id);
    }

    // ── 2. Sync resources ──────────────────────────────────────────────────
    const { resources: azureResources, usedFallback } = await queryResourceGraph(
      { azureTenantId: creds.azureTenantId, clientId: creds.clientId, clientSecret: creds.clientSecret },
      azureSubIds
    );
    console.log(`[ResourceSync] ${tenant.name}: ${azureRGs.length} RGs, ${azureResources.length} resources from Azure (fallback=${usedFallback})`);

    let resourcesUpserted = 0;
    let resourcesSkipped = 0;

    for (const res of azureResources) {
      const internalSubId = subIdMap.get(res.subscriptionId.toLowerCase());
      if (!internalSubId) {
        console.warn(`[ResourceSync] Resource "${res.name}" — subscriptionId ${res.subscriptionId} not in subIdMap`);
        resourcesSkipped++;
        continue;
      }

      // BUG FIX 1: look up RG by normalized name
      const rgName = res.resourceGroup?.trim() || "_unassigned";
      let rgId = rgMap.get(`${internalSubId}:${rgName.toLowerCase()}`);

      // BUG FIX 2: if RG not found (can happen with management/hidden resources),
      // create a placeholder so the resource is not silently dropped
      if (!rgId) {
        console.warn(`[ResourceSync] RG "${rgName}" not found for resource "${res.name}" — creating placeholder`);
        const placeholder = await prisma.resourceGroup.upsert({
          where: { tenantId_subscriptionId_name: { tenantId, subscriptionId: internalSubId, name: rgName } },
          create: {
            tenantId,
            subscriptionId: internalSubId,
            name: rgName,
            location: res.location,
            tags: {},
            isActive: true,
            lastSyncedAt: syncedAt,
          },
          update: { isActive: true, lastSyncedAt: syncedAt },
        });
        rgId = placeholder.id;
        rgMap.set(`${internalSubId}:${rgName.toLowerCase()}`, rgId);
      }

      await prisma.resource.upsert({
        where: { tenantId_resourceId: { tenantId, resourceId: res.id } },
        create: {
          tenantId,
          subscriptionId: internalSubId,
          resourceGroupId: rgId,
          resourceId: res.id,
          name: res.name,
          type: res.type,
          location: res.location,
          sku: res.sku !== null ? (res.sku as object) : undefined,
          provisioningState: res.provisioningState,
          tags: (res.tags ?? {}) as Record<string, string>,
          isActive: true,         // BUG FIX 2: explicitly set on INSERT
          manuallyRemoved: false,
          lastSyncedAt: syncedAt,
        },
        update: {
          name: res.name,
          type: res.type,
          location: res.location,
          sku: res.sku !== null ? (res.sku as object) : undefined,
          provisioningState: res.provisioningState,
          tags: (res.tags ?? {}) as Record<string, string>,
          isActive: true,
          // BUG FIX: sync is source of truth — clear manuallyRemoved on re-appearance
          manuallyRemoved: false,
          lastSyncedAt: syncedAt,
        },
      });

      resourcesUpserted++;
    }

    console.log(`[ResourceSync] ${tenant.name}: upserted=${resourcesUpserted} skipped=${resourcesSkipped}`);

    // BUG FIX 5: use lastSyncedAt timestamp for stale marking instead of notIn([...])
    // Resources/RGs not touched in this sync run = stale
    const staleRGs = await prisma.resourceGroup.updateMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: syncedAt } },
        ],
      },
      data: { isActive: false },
    });

    const staleResources = await prisma.resource.updateMany({
      where: {
        tenantId,
        isActive: true,
        manuallyRemoved: false, // don't touch manually removed records
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: syncedAt } },
        ],
      },
      data: { isActive: false },
    });

    const staleCount = staleRGs.count + staleResources.count;
    console.log(`[ResourceSync] ${tenant.name}: marked ${staleCount} stale (${staleRGs.count} RGs, ${staleResources.count} resources)`);

    return {
      tenantId,
      tenantName: tenant.name,
      success: true,
      resourceGroupsUpserted: rgMap.size,
      resourcesUpserted,
      resourcesSkipped,
      staleMarked: staleCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ResourceSync] ${tenant.name} FAILED:`, message);
    if (err instanceof Error) console.error(err.stack);
    return { tenantId, tenantName: tenant.name, success: false, resourceGroupsUpserted: 0, resourcesUpserted: 0, resourcesSkipped: 0, staleMarked: 0, error: message };
  }
}

export async function syncAllTenantsResources(): Promise<ResourceSyncResult[]> {
  const tenants = await prisma.tenant.findMany({
    where: { status: "CONNECTED" },
    select: { id: true },
  });

  const results: ResourceSyncResult[] = [];
  for (const t of tenants) {
    const result = await syncTenantResources(t.id);
    results.push(result);
  }
  return results;
}

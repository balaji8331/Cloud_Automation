/**
 * Syncs Azure-native budgets into the budgets table.
 * source = 'AZURE_NATIVE', upserted by azureBudgetId.
 * Portal-created budgets (source = 'PORTAL') are never touched.
 */
import prisma from "@/lib/db";
import { getTenantCredentials } from "@/lib/db/tenants";
import { syncAllAzureBudgets } from "@/lib/azure/budgets";

export async function syncAzureBudgetsForTenant(tenantId: string): Promise<number> {
  const creds = await getTenantCredentials(tenantId);
  if (!creds) return 0;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });

  const azureBudgets = await syncAllAzureBudgets(
    { azureTenantId: creds.azureTenantId, clientId: creds.clientId, clientSecret: creds.clientSecret },
    creds.subscriptions
  );

  console.log(`[BudgetSync] ${tenant?.name}: ${azureBudgets.length} Azure budgets found`);
  let upserted = 0;

  for (const ab of azureBudgets) {
    try {
      // Find internal subscription record
      const sub = creds.subscriptions.find((s) => s.subscriptionId === ab.subscriptionId);
      if (!sub) {
        console.warn(`[BudgetSync] ${tenant?.name}: no subscription found for Azure budget "${ab.name}" (subId=${ab.subscriptionId}), skipping`);
        continue;
      }

      // Map timeGrain
      const grain = ab.timeGrain.includes("Month") ? "MONTHLY"
        : ab.timeGrain.includes("Quarter") ? "QUARTERLY"
        : "ANNUALLY";

      // Upsert by azureBudgetId — now safe to use proper upsert since @@unique is set
      await prisma.budget.upsert({
        where: { azureBudgetId: ab.id },
        update: {
          name: ab.name,
          amount: ab.amount,
          timeGrain: grain as "MONTHLY" | "QUARTERLY" | "ANNUALLY",
          startDate: new Date(ab.startDate),
          endDate: ab.endDate ? new Date(ab.endDate) : null,
          azurePortalUrl: ab.azurePortalUrl,
        },
        create: {
          tenantId,
          subscriptionId: sub.id,
          name: ab.name,
          amount: ab.amount,
          timeGrain: grain as "MONTHLY" | "QUARTERLY" | "ANNUALLY",
          startDate: new Date(ab.startDate),
          endDate: ab.endDate ? new Date(ab.endDate) : undefined,
          alertThreshold: 0.8,
          azureBudgetId: ab.id,
          scopeType: ab.scope === "resource_group" ? "RESOURCE_GROUP" : "SUBSCRIPTION",
          scopeId: ab.resourceGroupName ?? sub.id,
          source: "AZURE_NATIVE",
          azurePortalUrl: ab.azurePortalUrl,
        },
      });
      upserted++;
    } catch (err) {
      console.error(`[BudgetSync] ${tenant?.name}: failed to upsert budget "${ab.name}":`, err);
      // Continue with remaining budgets — one bad record should not abort the whole sync
    }
  }

  console.log(`[BudgetSync] ${tenant?.name}: upserted ${upserted} Azure-native budgets`);
  return upserted;
}

export async function syncAllAzureBudgetsJob(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { status: "CONNECTED" },
    select: { id: true },
  });
  for (const t of tenants) {
    await syncAzureBudgetsForTenant(t.id).catch((e) =>
      console.error(`[BudgetSync] Tenant ${t.id} failed:`, e)
    );
  }
}

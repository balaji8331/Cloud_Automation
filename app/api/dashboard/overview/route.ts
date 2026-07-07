/**
 * GET /api/dashboard/overview?range=30d
 * Returns combined or scoped cost metrics for the overview dashboard.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import {
  getTotalCost,
  getDailyCosts,
  getCostByTenant,
  getCostBySubscription,
  getCostByService,
  getCostByResourceGroup,
} from "@/lib/db/costs";
import { getDateRange, type DateRange } from "@/lib/utils";
import { fromUsd } from "@/lib/currency";

export async function GET(req: Request) {
  try {
    await requireRole("READONLY");

    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || undefined;
    const subscriptionId = searchParams.get("subscriptionId") || undefined;
    const resourceGroup = searchParams.get("resourceGroup") || undefined;
    const currency = searchParams.get("currency") || "USD";
    const range = (searchParams.get("range") ?? "30d") as DateRange;
    const customFrom = searchParams.get("from");
    const customTo = searchParams.get("to");

    const { from, to } = getDateRange(
      range,
      customFrom ? new Date(customFrom) : undefined,
      customTo ? new Date(customTo) : undefined
    );

    const params = { tenantId, subscriptionId, resourceGroup, from, to };

    // Common data
    const [totalCost, dailyCosts, byService] = await Promise.all([
      getTotalCost(params),
      getDailyCosts(params),
      getCostByService(params),
    ]);

    // Dynamic breakdown based on scope
    let byBreakdown: { label: string; totalCost: number }[] = [];
    let breakdownType = "tenant";
    let breakdownLabel = "Cost by Tenant";
    let activeCount = 0;
    let activeCountLabel = "Active Tenants";

    if (resourceGroup) {
      // Scope: Single Resource Group
      breakdownType = "service";
      breakdownLabel = "Cost by Service";
      activeCountLabel = "Services";
      byBreakdown = byService.map(s => ({ label: s.serviceName, totalCost: s.totalCost }));
      activeCount = byService.length;
    } else if (subscriptionId) {
      // Scope: Single Subscription
      const byRg = await getCostByResourceGroup(params);
      breakdownType = "resource_group";
      breakdownLabel = "Cost by Resource Group";
      activeCountLabel = "Resource Groups";
      byBreakdown = byRg.map(r => ({ label: r.resourceGroup, totalCost: r.totalCost }));
      activeCount = byRg.length;
    } else if (tenantId) {
      // Scope: Single Tenant
      const bySub = await getCostBySubscription(tenantId, from, to);
      breakdownType = "subscription";
      breakdownLabel = "Cost by Subscription";
      activeCountLabel = "Subscriptions";
      byBreakdown = bySub.map(s => ({ label: s.subscriptionName, totalCost: s.totalCost }));
      activeCount = bySub.length;
    } else {
      // Scope: All Tenants
      const byTen = await getCostByTenant(from, to);
      breakdownType = "tenant";
      breakdownLabel = "Cost by Tenant";
      activeCountLabel = "Active Tenants";
      byBreakdown = byTen.map(t => ({ label: t.tenantName, totalCost: t.totalCost }));
      activeCount = byTen.length;
    }

    // Convert to requested currency
    const convertedTotalCost = fromUsd(totalCost, currency);
    const convertedDailyCosts = dailyCosts.map(d => ({ ...d, cost: fromUsd(d.cost, currency), currency }));
    const convertedByBreakdown = byBreakdown.map(b => ({ ...b, totalCost: fromUsd(b.totalCost, currency) }));
    const convertedByService = byService.map(s => ({ ...s, totalCost: fromUsd(s.totalCost, currency) }));

    return NextResponse.json({
      totalCost: convertedTotalCost,
      dailyCosts: convertedDailyCosts,
      byBreakdown: convertedByBreakdown,
      byService: convertedByService,
      breakdownType,
      breakdownLabel,
      scope: { tenantId: tenantId ?? null, subscriptionId: subscriptionId ?? null, resourceGroup: resourceGroup ?? null },
      activeCount,
      activeCountLabel,
      range,
      from: from.toISOString(),
      to: to.toISOString(),
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
